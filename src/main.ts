import { Notice, Plugin } from "obsidian";
import { GitHubApi } from "./github-api";
import { GitHubSyncSettingTab } from "./settings";
import { GIT_PAD_VIEW, GitPadSidebar } from "./sidebar";
import { SyncService } from "./sync-service";
import {
  defaultSettings,
  type GitHubSyncSettings,
  storedSettingsSchema,
} from "./types";
import { message } from "./utils";

export default class GitHubSyncMobilePlugin extends Plugin {
  settings: GitHubSyncSettings = { ...defaultSettings };
  private syncing = false;
  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new GitHubSyncSettingTab(this.app, this));
    this.registerView(GIT_PAD_VIEW, (leaf) => new GitPadSidebar(leaf, this));
    this.addCommand({
      id: "open-sidebar",
      name: "Open Git Pad sidebar",
      callback: () => this.openSidebar(),
    });
    this.addCommand({
      id: "pull",
      name: "Pull Markdown from GitHub",
      callback: () => this.runSync("pull"),
    });
    this.addCommand({
      id: "push",
      name: "Push Markdown to GitHub",
      callback: () => this.runSync("push"),
    });
  }
  async loadSettings(): Promise<void> {
    const parsed = storedSettingsSchema.safeParse(await this.loadData());
    this.settings = {
      ...defaultSettings,
      ...(parsed.success ? parsed.data : {}),
    };
    if (!parsed.success)
      console.warn("GitHub Sync: ignored invalid saved settings", parsed.error);
  }
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
  private configured(): boolean {
    return Boolean(
      this.settings.owner &&
        this.settings.repo &&
        this.app.secretStorage.getSecret(this.settings.tokenSecretName),
    );
  }
  async runSync(direction: "pull" | "push"): Promise<void> {
    if (this.syncing) {
      new Notice("Git Pad: a sync is already in progress.");
      return;
    }
    if (!this.configured()) {
      new Notice("GitHub Sync: configure the repository and credential first.");
      return;
    }
    this.syncing = true;
    const progress = new Notice(`Git Pad: starting ${direction}…`, 0);
    try {
      const result = await new SyncService(
        this.app,
        this.settings,
        undefined,
        (status) => progress.setMessage(`Git Pad: ${status}`),
      )[direction]();
      await this.saveSettings();
      if (result.headCommit) this.settings.lastSyncedCommit = result.headCommit;
      await this.saveSettings();
      progress.hide();
      new Notice(
        `GitHub Sync: ${direction === "pull" ? "pulled" : "pushed"} ${result.changed} file(s); ${result.conflicts.length} conflict(s); ${result.requiresPull.length} file(s) need a pull.`,
      );
      if (result.conflicts.length || result.requiresPull.length)
        console.warn("GitHub Sync", result);
    } catch (error) {
      progress.hide();
      console.error(error);
      new Notice(`GitHub Sync ${direction} failed: ${message(error)}`);
    } finally {
      this.syncing = false;
    }
  }
  async fetchStatus(): Promise<import("./types").GitStatus> {
    if (!this.configured())
      throw new Error("Configure repository and credential first.");
    const api = new GitHubApi(this.app, this.settings);
    const head = await api.getHead();
    return {
      head,
      commits: await api.getRecentCommits(),
      behind: this.settings.lastSyncedCommit
        ? await api.commitsAhead(this.settings.lastSyncedCommit, head)
        : undefined,
    };
  }
  private async openSidebar(): Promise<void> {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice("Git Pad: unable to open a sidebar in this workspace.");
      return;
    }
    await leaf.setViewState({ type: GIT_PAD_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
}
