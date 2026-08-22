export class App {
  secretStorage = { getSecret: (_name: string): string | null => null };
  vault!: unknown;
}
export class Plugin {
  app!: App;
  async loadData(): Promise<unknown> {
    return {};
  }
  async saveData(): Promise<void> {}
  addSettingTab(): void {}
  addCommand(): void {}
}
export class PluginSettingTab {
  containerEl = document.createElement("div");
  constructor(
    protected app: App,
    _plugin: Plugin,
  ) {}
}
export class Notice {
  constructor(_message: string) {}
}
export class Setting {
  constructor(_element: HTMLElement) {}
  setName(): this {
    return this;
  }
  setDesc(): this {
    return this;
  }
  addText(): this {
    return this;
  }
  addComponent(): this {
    return this;
  }
}
export class SecretComponent {
  constructor(_app: App, _element: HTMLElement) {}
  setValue(): this {
    return this;
  }
  onChange(): this {
    return this;
  }
}
export class TFile {
  constructor(public path = "") {}
}
export function normalizePath(path: string): string {
  return path;
}
export async function requestUrl(): Promise<never> {
  throw new Error("Mock requestUrl not configured");
}
