import { App } from "obsidian";
import { z } from "zod";
import { type HttpClient, obsidianHttpClient } from "./http-client";
import type { GitHubSyncSettings } from "./types";
import { decodeBase64, encodeBase64, remotePath } from "./utils";

const treeSchema = z.object({
  tree: z.array(
    z.object({
      path: z.string(),
      sha: z.string(),
      type: z.enum(["blob", "tree"]),
    }),
  ),
  truncated: z.boolean().optional(),
});
const fileSchema = z.object({
  sha: z.string(),
  content: z.string(),
  encoding: z.literal("base64"),
});
const refSchema = z.object({ object: z.object({ sha: z.string() }) });
const commitSchema = z.object({ tree: z.object({ sha: z.string() }) });
const shaSchema = z.object({ sha: z.string() });
const commitsSchema = z.array(
  z.object({
    sha: z.string(),
    commit: z.object({
      message: z.string(),
      author: z.object({ date: z.string() }),
    }),
  }),
);
const compareSchema = z.object({ ahead_by: z.number() });
export type RemoteEntry = z.infer<typeof treeSchema>["tree"][number];
const noProgress = (_message: string): void => undefined;

export class GitHubApi {
  constructor(
    private app: App,
    private settings: GitHubSyncSettings,
    private http: HttpClient = obsidianHttpClient,
    private onProgress: (message: string) => void = noProgress,
  ) {}

  async listMarkdownFiles(): Promise<Map<string, RemoteEntry>> {
    this.onProgress("Fetching repository index…");
    const root = this.root();
    const tree = await this.request(
      `/git/trees/${encodeURIComponent(this.settings.branch)}?recursive=1`,
      treeSchema,
    );
    if (tree.truncated)
      throw new Error(
        "Repository tree is too large for safe mobile sync. Select a smaller remote folder.",
      );
    const entries = new Map<string, RemoteEntry>();
    for (const entry of tree.tree) {
      if (entry.type !== "blob" || !entry.path.endsWith(".md")) continue;
      if (root && !entry.path.startsWith(`${root}/`)) continue;
      entries.set(root ? entry.path.slice(root.length + 1) : entry.path, entry);
    }
    return entries;
  }

  async getFile(path: string): Promise<{ sha: string; content: string }> {
    this.onProgress(`Fetching ${path}…`);
    const result = await this.request(
      `/contents/${remotePath(this.root(), path)}?ref=${encodeURIComponent(this.settings.branch)}`,
      fileSchema,
    );
    return {
      sha: result.sha,
      content: decodeBase64(result.content.replace(/\n/g, "")),
    };
  }

  async getHead(): Promise<string> {
    return (
      await this.request(
        `/git/ref/heads/${encodeURIComponent(this.settings.branch)}`,
        refSchema,
      )
    ).object.sha;
  }
  async getRecentCommits(): Promise<
    Array<{ sha: string; message: string; date: string }>
  > {
    const commits = await this.request(
      `/commits?sha=${encodeURIComponent(this.settings.branch)}&per_page=10`,
      commitsSchema,
    );
    return commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message.split("\n")[0] ?? "(no commit message)",
      date: commit.commit.author.date,
    }));
  }
  async commitsAhead(base: string, head: string): Promise<number> {
    return (
      await this.request(
        `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
        compareSchema,
      )
    ).ahead_by;
  }

  async createFilesCommit(
    files: Array<{ path: string; content: string }>,
  ): Promise<Map<string, string>> {
    if (files.length === 0) return new Map();
    this.onProgress("Preparing a GitHub commit…");
    const head = await this.request(
      `/git/ref/heads/${encodeURIComponent(this.settings.branch)}`,
      refSchema,
    );
    const parent = head.object.sha;
    const parentCommit = await this.request(
      `/git/commits/${parent}`,
      commitSchema,
    );
    this.onProgress(`Uploading ${files.length} changed note(s)…`);
    const blobs = await Promise.all(
      files.map(async (file) => ({
        path: file.path,
        sha: (
          await this.request("/git/blobs", shaSchema, "POST", {
            content: encodeBase64(file.content),
            encoding: "base64",
          })
        ).sha,
      })),
    );
    this.onProgress("Creating the Git tree…");
    const tree = await this.request("/git/trees", shaSchema, "POST", {
      base_tree: parentCommit.tree.sha,
      tree: blobs.map((blob) => ({
        path: [this.root(), blob.path].filter(Boolean).join("/"),
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      })),
    });
    this.onProgress("Creating the Git commit…");
    const commit = await this.request("/git/commits", shaSchema, "POST", {
      message: `obsidian: sync ${files.length} note(s)`,
      tree: tree.sha,
      parents: [parent],
    });
    this.onProgress("Updating the repository branch…");
    await this.request(
      `/git/refs/heads/${encodeURIComponent(this.settings.branch)}`,
      refSchema,
      "PATCH",
      { sha: commit.sha, force: false },
    );
    return new Map(blobs.map((blob) => [blob.path, blob.sha]));
  }

  private root(): string {
    return this.settings.vaultFolder.replace(/^\/+|\/+$/g, "");
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    const token = this.app.secretStorage.getSecret(
      this.settings.tokenSecretName,
    );
    if (!token)
      throw new Error("No GitHub credential is selected in settings.");
    const response = await this.http.request({
      url: `https://api.github.com/repos/${encodeURIComponent(this.settings.owner)}/${encodeURIComponent(this.settings.repo)}${path}`,
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body === undefined
        ? {}
        : { body: JSON.stringify(body), contentType: "application/json" }),
      throw: false,
    });
    if (response.status >= 300) {
      const detail =
        (response.json as { message?: string } | undefined)?.message ??
        response.text;
      throw new Error(`GitHub returned ${response.status}: ${detail}`);
    }
    const parsed = schema.safeParse(response.json);
    if (!parsed.success)
      throw new Error(
        `GitHub returned an invalid response: ${parsed.error.issues[0]?.message ?? "schema error"}`,
      );
    return parsed.data;
  }
}
