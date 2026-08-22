import { App, normalizePath, TFile } from "obsidian";
import { GitHubApi } from "./github-api";
import type { GitHubSyncSettings, SyncResult } from "./types";
import { contentHash } from "./utils";

const noProgress = (_message: string): void => undefined;

export class SyncService {
  private api: GitHubApi;

  constructor(
    private app: App,
    private settings: GitHubSyncSettings,
    api?: GitHubApi,
    private onProgress: (message: string) => void = noProgress,
  ) {
    this.api = api ?? new GitHubApi(app, settings, undefined, onProgress);
  }

  async pull(): Promise<SyncResult> {
    const remote = await this.api.listMarkdownFiles();
    this.onProgress(`Comparing ${remote.size} remote note(s)…`);
    const result: SyncResult = { changed: 0, conflicts: [], requiresPull: [] };
    let processed = 0;
    for (const [path, entry] of remote) {
      processed++;
      this.onProgress(`Pull: checking ${processed}/${remote.size}…`);
      const local = this.app.vault.getAbstractFileByPath(path);
      if (!(local instanceof TFile)) {
        const file = await this.api.getFile(path);
        await this.app.vault.create(normalizePath(path), file.content);
        this.settings.fileState[path] = {
          sha: file.sha,
          contentHash: await contentHash(file.content),
        };
        result.changed++;
        continue;
      }
      const localContent = await this.app.vault.read(local);
      const localHash = await contentHash(localContent);
      const known = this.settings.fileState[path];
      if (known?.sha === entry.sha) {
        this.settings.fileState[path] = {
          sha: entry.sha,
          contentHash: known.contentHash ?? localHash,
        };
        continue;
      }
      const remoteFile = await this.api.getFile(path);
      if (!known && localContent === remoteFile.content) {
        this.settings.fileState[path] = {
          sha: remoteFile.sha,
          contentHash: localHash,
        };
      } else if (known?.contentHash && known.contentHash === localHash) {
        await this.app.vault.modify(local, remoteFile.content);
        this.settings.fileState[path] = {
          sha: remoteFile.sha,
          contentHash: await contentHash(remoteFile.content),
        };
        result.changed++;
      } else {
        result.conflicts.push(path);
      }
    }
    if (result.conflicts.length === 0)
      result.headCommit = await this.api.getHead();
    return result;
  }

  async push(): Promise<SyncResult> {
    const remote = await this.api.listMarkdownFiles();
    const result: SyncResult = { changed: 0, conflicts: [], requiresPull: [] };
    const changes: Array<{ path: string; content: string; hash: string }> = [];
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !file.path.startsWith(".obsidian/"));
    this.onProgress(`Checking ${files.length} local note(s)…`);
    let processed = 0;
    for (const file of files) {
      processed++;
      this.onProgress(`Push: checking ${processed}/${files.length}…`);
      const content = await this.app.vault.read(file);
      const hash = await contentHash(content);
      const known = this.settings.fileState[file.path];
      const remoteEntry = remote.get(file.path);
      if (!remoteEntry) {
        changes.push({ path: file.path, content, hash });
        continue;
      }
      if (!known) {
        const remoteFile = await this.api.getFile(file.path);
        if (remoteFile.content === content)
          this.settings.fileState[file.path] = {
            sha: remoteFile.sha,
            contentHash: hash,
          };
        else result.conflicts.push(file.path);
        continue;
      }
      const localChanged =
        known.contentHash === undefined || known.contentHash !== hash;
      const remoteChanged = known.sha !== remoteEntry.sha;
      if (remoteChanged && localChanged) {
        result.conflicts.push(file.path);
        continue;
      }
      if (remoteChanged) {
        result.requiresPull.push(file.path);
        continue;
      }
      if (localChanged) changes.push({ path: file.path, content, hash });
    }
    const shas = await this.api.createFilesCommit(changes);
    for (const change of changes)
      this.settings.fileState[change.path] = {
        sha: shas.get(change.path) ?? "",
        contentHash: change.hash,
      };
    result.changed = changes.length;
    if (result.conflicts.length === 0 && result.requiresPull.length === 0)
      result.headCommit = await this.api.getHead();
    return result;
  }
}
