import { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { GitHubApi } from "./github-api";
import type { HttpClient, HttpRequest, HttpResponse } from "./http-client";
import { SyncService } from "./sync-service";
import { defaultSettings, type GitHubSyncSettings } from "./types";
import { contentHash, encodeBase64 } from "./utils";

class MemoryVault {
  readonly files = new Map<string, { file: TFile; content: string }>();
  readonly folders = new Map<string, TFile>();
  readonly configDir = ".obsidian";
  readonly adapter = {
    exists: async (path: string): Promise<boolean> =>
      path === this.configDir || this.files.has(path) || this.folders.has(path),
    read: (path: string): Promise<string> => {
      const entry = this.files.get(path);
      return entry
        ? Promise.resolve(entry.content)
        : Promise.reject(new Error(`Missing file: ${path}`));
    },
    write: (path: string, content: string): Promise<void> => {
      const entry = this.files.get(path);
      if (entry) entry.content = content;
      else this.add(path, content);
      return Promise.resolve();
    },
    writeBinary: (path: string, content: ArrayBuffer): Promise<void> => {
      this.add(path, new TextDecoder().decode(content));
      return Promise.resolve();
    },
    mkdir: (path: string): Promise<void> => {
      if (path === this.configDir || this.folders.has(path))
        return Promise.resolve();
      const folder = new TFile();
      folder.path = path;
      this.folders.set(path, folder);
      return Promise.resolve();
    },
  };

  add(path: string, content: string): TFile {
    const file = new TFile();
    file.path = path;
    this.files.set(path, { file, content });
    return file;
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path)?.file ?? this.folders.get(path) ?? null;
  }

  create(path: string, content: string): Promise<TFile> {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent && parent !== this.configDir && !this.folders.has(parent))
      return Promise.reject(new Error("Parent folder doesn't exist"));
    return Promise.resolve(this.add(path, content));
  }

  createBinary(path: string, content: ArrayBuffer): Promise<TFile> {
    return Promise.resolve(this.add(path, new TextDecoder().decode(content)));
  }

  createFolder(path: string): Promise<TFile> {
    const parent = path.split("/").slice(0, -1).join("/");
    if (parent && !this.folders.has(parent))
      return Promise.reject(new Error("Parent folder doesn't exist"));
    const folder = new TFile();
    folder.path = path;
    this.folders.set(path, folder);
    return Promise.resolve(folder);
  }

  modify(file: TFile, content: string): Promise<void> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`Missing file: ${file.path}`);
    entry.content = content;
    return Promise.resolve();
  }

  getMarkdownFiles(): TFile[] {
    return [...this.files.values()].map((entry) => entry.file);
  }

  getFiles(): TFile[] {
    return this.getMarkdownFiles();
  }

  read(file: TFile): Promise<string> {
    const entry = this.files.get(file.path);
    if (!entry) throw new Error(`Missing file: ${file.path}`);
    return Promise.resolve(entry.content);
  }
}

class FakeGitHubHttpClient implements HttpClient {
  readonly requests: string[] = [];

  constructor(
    private remoteContent: string,
    private remoteSha = "remote-blob-sha",
    private remotePath = "note.md",
    private head = "commit-old",
    private comparison?: unknown,
    private repositoryEntries?: Array<{
      path: string;
      sha: string;
      type: "blob";
    }>,
    private blobContents: Record<string, string> = {},
  ) {}

  request(request: HttpRequest): Promise<HttpResponse> {
    const url = new URL(request.url);
    const path = url.pathname.replace("/repos/acme/notes", "");
    this.requests.push(`${request.method ?? "GET"} ${path}${url.search}`);
    const response = (json: unknown, status = 200) =>
      ({ status, json, text: JSON.stringify(json) }) as HttpResponse;

    if (path.startsWith("/git/trees/")) {
      return Promise.resolve(
        response({
          tree: this.repositoryEntries ?? [
            { path: this.remotePath, sha: this.remoteSha, type: "blob" },
          ],
          truncated: false,
        }),
      );
    }
    if (path === `/contents/${this.remotePath}`) {
      return Promise.resolve(
        response({
          sha: this.remoteSha,
          content: encodeBase64(this.remoteContent),
          encoding: "base64",
        }),
      );
    }
    if (path === "/git/ref/heads/main" || path === "/git/refs/heads/main") {
      if (request.method === "PATCH")
        return Promise.resolve(response({ object: { sha: "commit-new" } }));
      return Promise.resolve(response({ object: { sha: this.head } }));
    }
    if (path.startsWith("/compare/"))
      return Promise.resolve(
        response(
          this.comparison ?? {
            status: "identical",
            ahead_by: 0,
            files: [],
          },
        ),
      );
    if (path === "/git/commits/commit-old") {
      return Promise.resolve(response({ tree: { sha: "tree-old" } }));
    }
    if (path === "/git/blobs")
      return Promise.resolve(response({ sha: "blob-new" }, 201));
    if (path.startsWith("/git/blobs/")) {
      const sha = path.slice("/git/blobs/".length);
      return Promise.resolve(
        response({
          sha,
          content: encodeBase64(this.blobContents[sha] ?? this.remoteContent),
          encoding: "base64",
        }),
      );
    }
    if (path === "/git/trees")
      return Promise.resolve(response({ sha: "tree-new" }, 201));
    if (path === "/git/commits")
      return Promise.resolve(response({ sha: "commit-new" }, 201));
    throw new Error(`Unexpected GitHub request: ${request.method} ${path}`);
  }
}

const createApp = (vault: MemoryVault): App =>
  ({
    vault,
    secretStorage: { getSecret: () => "test-token" },
  }) as unknown as App;

const createSettings = (): GitHubSyncSettings => ({
  ...defaultSettings,
  owner: "acme",
  repo: "notes",
  tokenSecretName: "github-token",
});

describe("GitHub sync integration", () => {
  it("adopts a cloned note without rewriting it when the plugin is installed later", async () => {
    const vault = new MemoryVault();
    vault.add("note.md", "clone content");
    const app = createApp(vault);
    const settings = createSettings();
    const http = new FakeGitHubHttpClient("clone content");
    const progress: string[] = [];
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
      (status) => progress.push(status),
    );

    await expect(service.pull()).resolves.toMatchObject({
      changed: 0,
      conflicts: [],
      headCommit: "commit-old",
    });
    expect(settings.fileState["note.md"]?.sha).toBe("remote-blob-sha");
    expect(
      await vault.read(vault.getAbstractFileByPath("note.md") as TFile),
    ).toBe("clone content");
    expect(progress).toContain("Comparing 1 remote file(s)…");
    expect(progress).toContain("Pull: checking 1/1 — note.md");
  });

  it("creates one GitHub commit for changed notes", async () => {
    const vault = new MemoryVault();
    vault.add("note.md", "updated locally");
    const app = createApp(vault);
    const settings = createSettings();
    settings.fileState["note.md"] = {
      sha: "remote-blob-sha",
      contentHash: await contentHash("original content"),
    };
    const http = new FakeGitHubHttpClient("original content");
    const progress: string[] = [];
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http, (status) => progress.push(status)),
    );

    await expect(service.push()).resolves.toMatchObject({
      changed: 1,
      conflicts: [],
    });
    expect(http.requests).toEqual([
      "GET /git/trees/main?recursive=1",
      "GET /git/ref/heads/main",
      "GET /git/commits/commit-old",
      "POST /git/blobs",
      "POST /git/trees",
      "POST /git/commits",
      "PATCH /git/refs/heads/main",
      "GET /git/ref/heads/main",
    ]);
    expect(settings.fileState["note.md"]?.sha).toBe("blob-new");
    expect(progress).toEqual(
      expect.arrayContaining([
        "Fetching repository index…",
        "Preparing a GitHub commit…",
        "Uploading 1 changed note(s)…",
        "Creating the Git tree…",
        "Creating the Git commit…",
        "Updating the repository branch…",
      ]),
    );
  });

  it("skips the repository tree and note checks when the saved commit is current", async () => {
    const vault = new MemoryVault();
    vault.add("note.md", "clone content");
    const app = createApp(vault);
    const settings = createSettings();
    settings.lastSyncedCommit = "commit-old";
    const http = new FakeGitHubHttpClient("clone content");
    const progress: string[] = [];
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
      (status) => progress.push(status),
    );

    await expect(service.pull()).resolves.toMatchObject({
      changed: 0,
      conflicts: [],
      headCommit: "commit-old",
    });
    expect(http.requests).toEqual([
      "GET /git/ref/heads/main",
      "GET /compare/commit-old...commit-old",
    ]);
    expect(progress).toContain("Comparing 0 changed remote file(s)…");
  });

  it("pulls only files reported as changed since the saved commit", async () => {
    const vault = new MemoryVault();
    const local = vault.add("note.md", "original content");
    const app = createApp(vault);
    const settings = createSettings();
    settings.lastSyncedCommit = "commit-old";
    settings.fileState["note.md"] = {
      sha: "old-blob-sha",
      contentHash: await contentHash("original content"),
    };
    const http = new FakeGitHubHttpClient(
      "updated content",
      "new-blob-sha",
      "note.md",
      "commit-new",
      {
        status: "ahead",
        ahead_by: 1,
        files: [
          { filename: "note.md", sha: "new-blob-sha", status: "modified" },
        ],
      },
    );
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.pull()).resolves.toMatchObject({
      changed: 1,
      conflicts: [],
      headCommit: "commit-new",
    });
    expect(await vault.read(local)).toBe("updated content");
    expect(http.requests).not.toContain(
      "GET /git/trees/commit-new?recursive=1",
    );
  });

  it("falls back to the pinned full tree after rewritten history", async () => {
    const vault = new MemoryVault();
    const app = createApp(vault);
    const settings = createSettings();
    settings.lastSyncedCommit = "missing-commit";
    const http = new FakeGitHubHttpClient(
      "remote content",
      "remote-blob-sha",
      "note.md",
      "commit-new",
      { status: "diverged", ahead_by: 1, files: [] },
    );
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.pull()).resolves.toMatchObject({
      changed: 1,
      headCommit: "commit-new",
    });
    expect(http.requests).toContain("GET /git/trees/commit-new?recursive=1");
  });

  it("falls back to the pinned full tree when comparison files are capped", async () => {
    const vault = new MemoryVault();
    const app = createApp(vault);
    const settings = createSettings();
    settings.lastSyncedCommit = "commit-old";
    const comparisonFiles = Array.from({ length: 300 }, (_, index) => ({
      filename: `note-${index}.md`,
      sha: `blob-${index}`,
      status: "modified" as const,
    }));
    const http = new FakeGitHubHttpClient(
      "remote content",
      "remote-blob-sha",
      "note.md",
      "commit-new",
      { status: "ahead", ahead_by: 300, files: comparisonFiles },
    );
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.pull()).resolves.toMatchObject({ changed: 1 });
    expect(http.requests).toContain("GET /git/trees/commit-new?recursive=1");
  });

  it("replaces a conflicting local note when forced GitHub Pull is enabled", async () => {
    const vault = new MemoryVault();
    const local = vault.add("note.md", "local content");
    const app = createApp(vault);
    const settings = createSettings();
    settings.forcePullFromGitHub = true;
    const http = new FakeGitHubHttpClient("GitHub content");
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.pull()).resolves.toMatchObject({
      changed: 1,
      conflicts: [],
    });
    expect(await vault.read(local)).toBe("GitHub content");
    expect(settings.fileState["note.md"]?.sha).toBe("remote-blob-sha");
  });

  it("clones every repository blob, including .obsidian and binary files", async () => {
    const vault = new MemoryVault();
    const app = createApp(vault);
    const settings = createSettings();
    const http = new FakeGitHubHttpClient(
      "unused",
      "unused-sha",
      "unused.md",
      "commit-clone",
      undefined,
      [
        { path: "note.md", sha: "note-sha", type: "blob" },
        { path: "image.png", sha: "image-sha", type: "blob" },
        { path: ".obsidian/app.json", sha: "config-sha", type: "blob" },
        {
          path: ".obsidian/plugins/git-pad/main.js",
          sha: "plugin-sha",
          type: "blob",
        },
      ],
      {
        "note-sha": "# Cloned note",
        "image-sha": "binary image content",
        "config-sha": '{"theme":"Minimal"}',
        "plugin-sha": "plugin bundle",
      },
    );
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.clone()).resolves.toMatchObject({
      changed: 4,
      conflicts: [],
      headCommit: "commit-clone",
      requiresReload: true,
    });
    expect(
      await vault.read(vault.getAbstractFileByPath("note.md") as TFile),
    ).toBe("# Cloned note");
    expect(vault.getAbstractFileByPath("image.png")).toBeInstanceOf(TFile);
    expect(
      await vault.read(
        vault.getAbstractFileByPath(".obsidian/app.json") as TFile,
      ),
    ).toBe('{"theme":"Minimal"}');
    expect(
      vault.getAbstractFileByPath(".obsidian/plugins/git-pad/main.js"),
    ).toBeInstanceOf(TFile);
    expect(settings.fileState["note.md"]?.sha).toBe("note-sha");
  });

  it("creates missing parent folders before pulling a nested note", async () => {
    const vault = new MemoryVault();
    const app = createApp(vault);
    const settings = createSettings();
    const http = new FakeGitHubHttpClient(
      "nested content",
      "remote-blob-sha",
      "Inbox/2026/note.md",
    );
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.pull()).resolves.toMatchObject({ changed: 1 });
    expect(vault.folders.has("Inbox")).toBe(true);
    expect(vault.folders.has("Inbox/2026")).toBe(true);
    expect(
      await vault.read(
        vault.getAbstractFileByPath("Inbox/2026/note.md") as TFile,
      ),
    ).toBe("nested content");
  });

  it("pulls safe Obsidian configuration without pulling installed plugins", async () => {
    const vault = new MemoryVault();
    const app = createApp(vault);
    const settings = createSettings();
    const http = new FakeGitHubHttpClient(
      '{"showLineNumber":true}',
      "config-blob-sha",
      ".obsidian/app.json",
    );
    const service = new SyncService(
      app,
      settings,
      new GitHubApi(app, settings, http),
    );

    await expect(service.pull()).resolves.toMatchObject({ changed: 1 });
    expect(
      await vault.read(
        vault.getAbstractFileByPath(".obsidian/app.json") as TFile,
      ),
    ).toBe('{"showLineNumber":true}');
    expect(vault.folders.has(".obsidian")).toBe(false);
  });
});
