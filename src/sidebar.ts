import { ItemView, type WorkspaceLeaf } from "obsidian";
import type GitPadPlugin from "./main";
import type { GitStatus } from "./types";

export const GIT_PAD_VIEW = "git-pad-sidebar";

export class GitPadSidebar extends ItemView {
  private progressEl: HTMLElement | null = null;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: GitPadPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return GIT_PAD_VIEW;
  }
  getDisplayText(): string {
    return "Git Pad";
  }
  getIcon(): string {
    return "git-branch";
  }
  async onOpen(): Promise<void> {
    await this.render();
  }
  async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.createEl("h4", { text: "Git Pad" });
    this.progressEl = root.createDiv({
      cls: "git-pad-progress",
      text: this.plugin.syncStatus,
    });
    const actions = root.createDiv({ cls: "git-pad-actions" });
    for (const [label, action] of [
      ["Fetch", () => this.plugin.fetchStatus()],
      ["Pull", () => this.plugin.runSync("pull")],
      ["Commit & Push", () => this.plugin.runSync("push")],
    ] as const) {
      const button = actions.createEl("button", { text: label });
      button.onclick = async () => {
        button.disabled = true;
        await action();
        await this.render();
      };
    }
    const content = root.createDiv({ text: "Fetching repository status…" });
    try {
      this.status(content, await this.plugin.fetchStatus());
    } catch (error) {
      content.setText(
        `Status unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  updateProgress(status: string): void {
    this.progressEl?.setText(status);
  }
  private status(container: HTMLElement, status: GitStatus): void {
    container.empty();
    container.createEl("p", {
      text:
        status.behind === undefined
          ? "No sync baseline yet."
          : `${status.behind} commit(s) behind.`,
    });
    const list = container.createEl("ul");
    for (const commit of status.commits)
      list.createEl("li", {
        text: `${commit.message} (${commit.sha.slice(0, 7)})`,
      });
  }
}
