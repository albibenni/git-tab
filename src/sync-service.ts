import { App, normalizePath, TFile } from "obsidian";
import { GitHubApi } from "./github-api";
import type { GitHubSyncSettings, SyncResult } from "./types";
import {
  contentHash,
  gitBlobSha,
  isSyncableVaultPath,
  mapConcurrent,
  withTimeout,
} from "./utils";

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
      this.onProgress("Fetching repository head…");
      const head = await withTimeout(
        this.api.getHead(),
        pullNoteTimeoutMs,
        "Fetching repository head",
        () => controller.abort(),
      );
      throwIfAborted(controller.signal);
      const changed = this.settings.lastSyncedCommit
        ? await withTimeout(
            this.api.listChangedSyncFiles(this.settings.lastSyncedCommit, head),
            pullNoteTimeoutMs,
            "Comparing repository commits",
            () => controller.abort(),
          )
        : undefined;
      const remote =
        changed ??
        (await withTimeout(
          this.api.listSyncFiles(head),
          pullNoteTimeoutMs,
          "Fetching repository index",
          () => controller.abort(),
        ));
      throwIfAborted(controller.signal);
      this.onProgress(
        changed
          ? `Comparing ${remote.size} changed remote file(s)…`
          : `Comparing ${remote.size} remote file(s)…`,
      );
      const result: SyncResult = {
        changed: 0,
        conflicts: [],
        requiresPull: [],
      };
      let completed = 0;
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
              this.pullNote(path, entry, result, controller.signal, head),
              pullNoteTimeoutMs,
              `Pulling ${path}`,
              () => controller.abort(),
            );
            throwIfAborted(controller.signal);
            completed++;
            this.onProgress(
              `Pull: completed ${completed}/${remote.size} — ${path}`,
            );
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
        result.headCommit = head;
      }
      return result;
    } catch (error) {
      controller.abort();
      throw error;
    }
  }

  async clone(): Promise<SyncResult> {
    if (this.settings.vaultFolder)
      throw new Error(
        "Clear Remote folder before cloning an entire repository into this vault.",
      );
    const configDir = normalizePath(this.app.vault.configDir);
    const existingFiles = this.app.vault
      .getFiles()
      .filter((file) => !file.path.startsWith(`${configDir}/`));
    if (existingFiles.length)
      throw new Error(
        `Clone requires an empty vault. Found ${existingFiles.length} existing vault file(s).`,
      );
    const controller = new AbortController();
    try {
      this.onProgress("Fetching repository head for clone…");
      const head = await withTimeout(
        this.api.getHead(),
        pullNoteTimeoutMs,
        "Fetching repository head for clone",
        () => controller.abort(),
      );
      const remote = await withTimeout(
        this.api.listRepositoryFiles(head),
        pullNoteTimeoutMs,
        "Fetching repository tree for clone",
        () => controller.abort(),
      );
      const result: SyncResult = {
        changed: 0,
        conflicts: [],
        requiresPull: [],
      };
      let completed = 0;
      await mapConcurrent(
        [...remote.entries()],
        this.settings.pullConcurrency,
        async ([path, entry], index) => {
          try {
            this.onProgress(
              `Clone: fetching ${index + 1}/${remote.size} — ${path}`,
            );
            await withTimeout(
              this.cloneFile(path, entry, result, controller.signal),
              pullNoteTimeoutMs,
              `Cloning ${path}`,
              () => controller.abort(),
            );
            throwIfAborted(controller.signal);
            completed++;
            this.onProgress(
              `Clone: completed ${completed}/${remote.size} — ${path}`,
            );
          } catch (error) {
            controller.abort();
            throw error;
          }
        },
        () => controller.signal.aborted,
      );
      result.headCommit = head;
      result.requiresReload = [...remote.keys()].some((path) =>
        path.startsWith(`${configDir}/plugins/git-pad/`),
      );
      return result;
    } catch (error) {
      controller.abort();
      throw error;
    }
  }

  private async cloneFile(
    path: string,
    entry: import("./github-api").RemoteEntry,
    result: SyncResult,
    signal: AbortSignal,
  ): Promise<void> {
    const normalizedPath = normalizePath(path);
    if (
      !normalizedPath ||
      normalizedPath === ".." ||
      normalizedPath.startsWith("../") ||
      path.startsWith("/")
    )
      throw new Error(`Repository contains an unsafe path: ${path}`);
    const content = await this.api.getBlob(entry.sha);
    throwIfAborted(signal);
    const configPath = normalizedPath.startsWith(
      `${normalizePath(this.app.vault.configDir)}/`,
    );
    if (configPath) {
      await this.ensureConfigParentFolders(normalizedPath, signal);
      await this.app.vault.adapter.writeBinary(normalizedPath, content);
    } else {
      await this.ensureParentFolders(normalizedPath, signal);
      await this.app.vault.createBinary(normalizedPath, content);
    }
    throwIfAborted(signal);
    if (
      isSyncableVaultPath(
        normalizedPath,
        this.app.vault.configDir,
        this.settings.syncObsidianConfig,
      )
    ) {
      const localContent = new TextDecoder().decode(content);
      this.settings.fileState[normalizedPath] = {
        sha: entry.sha,
        contentHash: await contentHash(localContent),
      };
    }
    result.changed++;
  }

  private async pullNote(
    path: string,
    entry: import("./github-api").RemoteEntry,
    result: SyncResult,
    signal: AbortSignal,
    ref: string,
  ): Promise<void> {
    throwIfAborted(signal);
    const normalizedPath = normalizePath(path);
    const configPath = normalizedPath.startsWith(
      `${normalizePath(this.app.vault.configDir)}/`,
    );
    if (this.settings.forcePullFromGitHub) {
      await this.forcePullNote(
        path,
        result,
        signal,
        normalizedPath,
        configPath,
        ref,
      );
      return;
    }
    if (configPath)
      return this.pullConfigFile(
        path,
        entry,
        result,
        signal,
        normalizedPath,
        ref,
      );
    const local = this.app.vault.getAbstractFileByPath(path);
    if (!(local instanceof TFile)) {
      const file = await this.api.getFile(path, ref);
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
    const remoteFile = await this.api.getFile(path, ref);
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

  private async forcePullNote(
    path: string,
    result: SyncResult,
    signal: AbortSignal,
    normalizedPath: string,
    configPath: boolean,
    ref: string,
  ): Promise<void> {
    const remoteFile = await this.api.getFile(path, ref);
    throwIfAborted(signal);
    const remoteContentHash = await contentHash(remoteFile.content);
    throwIfAborted(signal);
    if (configPath) {
      const exists = await this.app.vault.adapter.exists(normalizedPath);
      const localContent = exists
        ? await this.app.vault.adapter.read(normalizedPath)
        : undefined;
      throwIfAborted(signal);
      if (!exists) await this.ensureConfigParentFolders(normalizedPath, signal);
      if (localContent !== remoteFile.content) {
        await this.app.vault.adapter.write(normalizedPath, remoteFile.content);
        throwIfAborted(signal);
        result.changed++;
      }
    } else {
      const local = this.app.vault.getAbstractFileByPath(path);
      if (local && !(local instanceof TFile))
        throw new Error(
          `Cannot replace ${path}: a folder exists at that path.`,
        );
      const localContent = local ? await this.app.vault.read(local) : undefined;
      throwIfAborted(signal);
      if (!local) await this.ensureParentFolders(path, signal);
      if (localContent !== remoteFile.content) {
        if (local) await this.app.vault.modify(local, remoteFile.content);
        else await this.app.vault.create(normalizedPath, remoteFile.content);
        throwIfAborted(signal);
        result.changed++;
      }
    }
    this.settings.fileState[path] = {
      sha: remoteFile.sha,
      contentHash: remoteContentHash,
    };
  }

  private async pullConfigFile(
    path: string,
    entry: import("./github-api").RemoteEntry,
    result: SyncResult,
    signal: AbortSignal,
    normalizedPath: string,
    ref: string,
  ): Promise<void> {
    if (!(await this.app.vault.adapter.exists(normalizedPath))) {
      const file = await this.api.getFile(path, ref);
      throwIfAborted(signal);
      await this.ensureConfigParentFolders(normalizedPath, signal);
      throwIfAborted(signal);
      await this.app.vault.adapter.write(normalizedPath, file.content);
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
    const localContent = await this.app.vault.adapter.read(normalizedPath);
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
    const remoteFile = await this.api.getFile(path, ref);
    throwIfAborted(signal);
    if (!known && localContent === remoteFile.content) {
      this.settings.fileState[path] = {
        sha: remoteFile.sha,
        contentHash: localHash,
      };
    } else if (known?.contentHash && known.contentHash === localHash) {
      await this.app.vault.adapter.write(normalizedPath, remoteFile.content);
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
    const configDir = normalizePath(this.app.vault.configDir);
    let folder = "";
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      throwIfAborted(signal);
      if (folder === configDir) continue;
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

  private async ensureConfigParentFolders(
    path: string,
    signal: AbortSignal,
  ): Promise<void> {
    const parts = path.split("/");
    parts.pop();
    let folder = "";
    for (const part of parts) {
      folder = folder ? `${folder}/${part}` : part;
      throwIfAborted(signal);
      if (await this.app.vault.adapter.exists(folder)) continue;
      await this.app.vault.adapter.mkdir(folder);
      throwIfAborted(signal);
    }
  }

  async push(): Promise<SyncResult> {
    const remote = await this.api.listSyncFiles();
    const result: SyncResult = { changed: 0, conflicts: [], requiresPull: [] };
    const changes: Array<{ path: string; content: string; hash: string }> = [];
    const files = this.app.vault
      .getFiles()
      .filter((file) =>
        isSyncableVaultPath(
          file.path,
          this.app.vault.configDir,
          this.settings.syncObsidianConfig,
        ),
      );
    this.onProgress(`Checking ${files.length} local note(s)…`);
    let processed = 0;
    for (const file of files) {
      processed++;
      this.onProgress(`Push: checking ${processed}/${files.length}…`);
      const content = await withTimeout(
        this.app.vault.read(file),
        pullNoteTimeoutMs,
        `Reading ${file.path}`,
      );
      const hash = await withTimeout(
        contentHash(content),
        pullNoteTimeoutMs,
        `Hashing ${file.path}`,
      );
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
