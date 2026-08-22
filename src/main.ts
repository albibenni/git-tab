import { Notice, Plugin } from "obsidian";
import { GitHubSyncSettingTab } from "./settings";
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
    this.addCommand({
      id: "pull",
      name: "Pull Markdown from GitHub",
      callback: () => this.sync("pull"),
    });
    this.addCommand({
      id: "push",
      name: "Push Markdown to GitHub",
      callback: () => this.sync("push"),
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
  private async sync(direction: "pull" | "push"): Promise<void> {
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
}
