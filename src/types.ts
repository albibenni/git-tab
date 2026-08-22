import { z } from "zod";

export const fileStateSchema = z.object({
  sha: z.string().min(1),
  contentHash: z.string().min(1).optional(),
});

export const storedSettingsSchema = z
  .object({
    owner: z.string(),
    repo: z.string(),
    branch: z.string(),
    vaultFolder: z.string(),
    tokenSecretName: z.string(),
    fileState: z.record(z.string(), fileStateSchema),
  })
  .partial();

export interface GitHubSyncSettings {
  owner: string;
  repo: string;
  branch: string;
  vaultFolder: string;
  tokenSecretName: string;
  lastSyncedCommit?: string;
  fileState: Record<string, z.infer<typeof fileStateSchema>>;
}

export const defaultSettings: GitHubSyncSettings = {
  owner: "",
  repo: "",
  branch: "main",
  vaultFolder: "",
  tokenSecretName: "",
  fileState: {},
};

export type SyncResult = {
  changed: number;
  conflicts: string[];
  requiresPull: string[];
  headCommit?: string;
};

export type GitStatus = {
  head: string;
  behind?: number;
  commits: Array<{ sha: string; message: string; date: string }>;
};
