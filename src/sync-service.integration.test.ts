import { App, TFile } from "obsidian";
import { describe, expect, it } from "vitest";
import { GitHubApi } from "./github-api";
import type { HttpClient, HttpRequest, HttpResponse } from "./http-client";
import { SyncService } from "./sync-service";
import { defaultSettings, type GitHubSyncSettings } from "./types";
import { contentHash, encodeBase64 } from "./utils";

class MemoryVault {
  readonly files = new Map<string, { file: TFile; content: string }>();

  add(path: string, content: string): TFile {
    const file = new TFile();
    file.path = path;
    this.files.set(path, { file, content });
    return file;
  }

  getAbstractFileByPath(path: string): TFile | null {
    return this.files.get(path)?.file ?? null;
  }

  create(path: string, content: string): Promise<TFile> {
    return Promise.resolve(this.add(path, content));
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
  ) {}

  request(request: HttpRequest): Promise<HttpResponse> {
    const url = new URL(request.url);
    const path = url.pathname.replace("/repos/acme/notes", "");
    this.requests.push(`${request.method ?? "GET"} ${path}${url.search}`);
    const response = (json: unknown, status = 200) =>
      ({ status, json, text: JSON.stringify(json) }) as HttpResponse;

    if (path === "/git/trees/main") {
      return Promise.resolve(
        response({
          tree: [{ path: "note.md", sha: this.remoteSha, type: "blob" }],
          truncated: false,
        }),
      );
    }
    if (path === "/contents/note.md") {
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
      return Promise.resolve(response({ object: { sha: "commit-old" } }));
    }
    if (path === "/git/commits/commit-old") {
      return Promise.resolve(response({ tree: { sha: "tree-old" } }));
    }
    if (path === "/git/blobs")
      return Promise.resolve(response({ sha: "blob-new" }, 201));
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
    });
    expect(settings.fileState["note.md"]?.sha).toBe("remote-blob-sha");
    expect(
      await vault.read(vault.getAbstractFileByPath("note.md") as TFile),
    ).toBe("clone content");
    expect(progress).toContain("Comparing 1 remote note(s)…");
    expect(progress).toContain("Pull: checking 1/1…");
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
});
