import { App, normalizePath, TFile } from "obsidian";
import { GitHubApi } from "./github-api";
import type { GitHubSyncSettings, SyncResult } from "./types";
import { contentHash, gitBlobSha, mapConcurrent, withTimeout } from "./utils";

const noProgress = (_message: string): void => undefined;
const pullNoteTimeoutMs = 60_000;

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new Error("Pull cancelled after an earlier operation failed.");
}

export class SyncService {
  private api: GitHubApi;
  private folderCreations = new Map<string, Promise<void>>();

  constructor(
    private app: App,
    private settings: GitHubSyncSettings,
    api?: GitHubApi,
    private onProgress: (message: string) => void = noProgress,
  ) {
    this.api = api ?? new GitHubApi(app, settings, undefined, onProgress);
  }

  async pull(): Promise<SyncResult> {
    const controller = new AbortController();
    try {
      const remote = await withTimeout(
        this.api.listMarkdownFiles(),
        pullNoteTimeoutMs,
        "Fetching repository index",
        () => controller.abort(),
      );
      throwIfAborted(controller.signal);
      this.onProgress(`Comparing ${remote.size} remote note(s)…`);
      const result: SyncResult = {
        changed: 0,
        conflicts: [],
        requiresPull: [],
      };
      await mapConcurrent(
        [...remote.entries()],
        this.settings.pullConcurrency,
        async ([path, entry], index) => {
          try {
            throwIfAborted(controller.signal);
            this.onProgress(
              `Pull: checking ${index + 1}/${remote.size} — ${path}`,
            );
            await withTimeout(
              this.pullNote(path, entry, result, controller.signal),
              pullNoteTimeoutMs,
              `Pulling ${path}`,
              () => controller.abort(),
            );
            throwIfAborted(controller.signal);
          } catch (error) {
            controller.abort();
            throw error;
          }
        },
        () => controller.signal.aborted,
      );
      throwIfAborted(controller.signal);
      this.onProgress("Pull: finalizing note checks…");
      if (result.conflicts.length === 0) {
        this.onProgress("Pull: fetching final branch status…");
        result.headCommit = await withTimeout(
          this.api.getHead(),
          pullNoteTimeoutMs,
          "Fetching final branch status",
          () => controller.abort(),
        );
      }
      return result;
    } catch (error) {
      controller.abort();
      throw error;
    }
  }

  private async pullNote(
    path: string,
    entry: import("./github-api").RemoteEntry,
    result: SyncResult,
    signal: AbortSignal,
  ): Promise<void> {
    throwIfAborted(signal);
    const local = this.app.vault.getAbstractFileByPath(path);
    if (!(local instanceof TFile)) {
      const file = await this.api.getFile(path);
      throwIfAborted(signal);
      await this.ensureParentFolders(path, signal);
      throwIfAborted(signal);
      await this.app.vault.create(normalizePath(path), file.content);
      throwIfAborted(signal);
      const fileContentHash = await contentHash(file.content);
      throwIfAborted(signal);
      this.settings.fileState[path] = {
        sha: file.sha,
        contentHash: fileContentHash,
      };
      result.changed++;
      return;
    }
    const localContent = await this.app.vault.read(local);
    throwIfAborted(signal);
    const localHash = await contentHash(localContent);
    throwIfAborted(signal);
    const known = this.settings.fileState[path];
    if (known?.sha === entry.sha) {
      this.settings.fileState[path] = {
        sha: entry.sha,
        contentHash: known.contentHash ?? localHash,
      };
      return;
    }
    if (
      !known &&
      entry.sha.length === 40 &&
      (await gitBlobSha(localContent)) === entry.sha
    ) {
      throwIfAborted(signal);
      this.settings.fileState[path] = {
        sha: entry.sha,
        contentHash: localHash,
      };
      return;
    }
    const remoteFile = await this.api.getFile(path);
    throwIfAborted(signal);
    if (!known && localContent === remoteFile.content) {
      this.settings.fileState[path] = {
        sha: remoteFile.sha,
        contentHash: localHash,
      };
    } else if (known?.contentHash && known.contentHash === localHash) {
      await this.app.vault.modify(local, remoteFile.content);
      throwIfAborted(signal);
      const remoteContentHash = await contentHash(remoteFile.content);
      throwIfAborted(signal);
      this.settings.fileState[path] = {
        sha: remoteFile.sha,
        contentHash: remoteContentHash,
      };
      result.changed++;
    } else {
      result.conflicts.push(path);
    }
  }

  private async ensureParentFolders(
    path: string,
    signal: AbortSignal,
  ): Promise<void> {
    const parts = normalizePath(path).split("/");
    parts.pop();
    let folder = "";
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      throwIfAborted(signal);
      if (this.app.vault.getAbstractFileByPath(folder)) continue;
      let creation = this.folderCreations.get(folder);
      if (!creation) {
        creation = this.app.vault
          .createFolder(folder)
          .then(() => undefined)
          .catch((error: unknown) => {
            if (this.app.vault.getAbstractFileByPath(folder)) return;
            throw error;
          });
        this.folderCreations.set(folder, creation);
      }
      await creation;
      throwIfAborted(signal);
    }
  }

  async push(): Promise<SyncResult> {
    const remote = await this.api.listMarkdownFiles();
    const result: SyncResult = { changed: 0, conflicts: [], requiresPull: [] };
    const changes: Array<{ path: string; content: string; hash: string }> = [];
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => !file.path.startsWith(`${this.app.vault.configDir}/`));
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
