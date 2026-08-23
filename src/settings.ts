import {
  App,
  PluginSettingTab,
  SecretComponent,
  Setting,
  type SettingDefinitionItem,
} from "obsidian";
import type GitHubSyncMobilePlugin from "./main";
import type { GitHubSyncSettings } from "./types";

type TextSettingKey = "owner" | "repo" | "branch" | "vaultFolder";

const textSettings: Array<{ key: TextSettingKey; name: string; desc: string }> =
  [
    {
      key: "owner",
      name: "Repository owner",
      desc: "GitHub user or organization.",
    },
    { key: "repo", name: "Repository name", desc: "For example: notes." },
    { key: "branch", name: "Branch", desc: "Usually main." },
    {
      key: "vaultFolder",
      name: "Remote folder",
      desc: "Optional repository subfolder.",
    },
  ];

export class GitHubSyncSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: GitHubSyncMobilePlugin,
  ) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        type: "group",
        heading: "Git Pad",
        items: [
          ...textSettings.map(({ key, name, desc }) => ({
            name,
            desc,
            control: { type: "text" as const, key },
          })),
          {
            name: "First Pull speed",
            desc: "Concurrent note checks during first Pull. Use 2–4 on older iPads and 6–8 on recent iPads; higher values use more memory and can trigger GitHub limits.",
            control: {
              type: "slider" as const,
              key: "pullConcurrency",
              min: 1,
              max: 12,
              step: 1,
            },
          },
          {
            name: "Sync Obsidian configuration",
            desc: "Sync .obsidian JSON and CSS, excluding all installed plugins and device-specific workspace layouts.",
            control: { type: "toggle" as const, key: "syncObsidianConfig" },
          },
          {
            name: "GitHub credential",
            desc: "Select or create a secret. Only its name is saved in plugin settings.",
            render: (setting: Setting) => {
              setting.addComponent((element) =>
                new SecretComponent(this.app, element)
                  .setValue(this.plugin.settings.tokenSecretName)
                  .onChange(async (value) => {
                    this.plugin.settings.tokenSecretName = value;
                    await this.plugin.saveSettings();
                  }),
              );
            },
          },
        ],
      },
    ];
  }

  getControlValue(key: string): unknown {
    return this.plugin.settings[key as keyof GitHubSyncSettings];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "pullConcurrency" && typeof value === "number") {
      this.plugin.settings.pullConcurrency = value;
    } else if (key === "syncObsidianConfig" && typeof value === "boolean") {
      this.plugin.settings.syncObsidianConfig = value;
    } else if (
      textSettings.some((setting) => setting.key === key) &&
      typeof value === "string"
    ) {
      this.plugin.settings[key as TextSettingKey] = value.trim();
    } else return;
    await this.plugin.saveSettings();
  }

  // Obsidian before 1.13 uses this imperative fallback.
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Git Pad")
      .setDesc(
        "A clone can be installed and configured later: identical notes are adopted without being rewritten.",
      )
      .setHeading();
    for (const { key, name, desc } of textSettings)
      this.addText(name, desc, key);
    new Setting(containerEl)
      .setName("First Pull speed")
      .setDesc(
        "Concurrent note checks during first Pull. Higher values use more memory and can trigger GitHub limits.",
      )
      .addSlider((slider) =>
        slider
          .setLimits(1, 12, 1)
          .setValue(this.plugin.settings.pullConcurrency)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pullConcurrency = value;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName("Sync Obsidian configuration")
      .setDesc(
        "Sync .obsidian JSON and CSS, excluding all installed plugins and device-specific workspace layouts.",
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.syncObsidianConfig)
          .onChange(async (value) => {
            this.plugin.settings.syncObsidianConfig = value;
            await this.plugin.saveSettings();
          }),
      );
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

  private addText(name: string, desc: string, key: TextSettingKey): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) =>
        text.setValue(this.plugin.settings[key]).onChange(async (value) => {
          this.plugin.settings[key] = value.trim();
          await this.plugin.saveSettings();
        }),
      );
  }
}
