import { App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type GitHubSyncMobilePlugin from "./main";

export class GitHubSyncSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GitHubSyncMobilePlugin,
  ) {
    super(app, plugin);
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "GitHub Sync Mobile" });
    containerEl.createEl("p", {
      text: "A clone can be installed and configured later: identical notes are adopted without being rewritten.",
    });
    this.text("Repository owner", "GitHub user or organization.", "owner");
    this.text("Repository name", "For example: notes.", "repo");
    this.text("Branch", "Usually main.", "branch");
    this.text("Remote folder", "Optional repository subfolder.", "vaultFolder");
    new Setting(containerEl)
      .setName("GitHub credential")
      .setDesc(
        "Select or create a secret. Only its name is saved in plugin settings.",
      )
      .addComponent((element) =>
        new SecretComponent(this.app, element)
          .setValue(this.plugin.settings.tokenSecretName)
          .onChange(async (value) => {
            this.plugin.settings.tokenSecretName = value;
            await this.plugin.saveSettings();
          }),
      );
  }
  private text(
    name: string,
    description: string,
    field: "owner" | "repo" | "branch" | "vaultFolder",
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(this.plugin.settings[field]).onChange(async (value) => {
          this.plugin.settings[field] = value.trim();
          await this.plugin.saveSettings();
        }),
      );
  }
}
