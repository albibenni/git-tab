# Git Pad

A mobile-first Obsidian plugin that synchronizes Markdown files and selected Obsidian configuration with a GitHub repository through the GitHub API. It works on iPadOS because it does not rely on native Git, Node.js, Electron, or SSH.

## Current scope

- Pull Markdown files from a repository branch into the vault.
- Push changed Markdown files as one GitHub commit.
- Optionally sync safe `.obsidian` JSON and CSS files; installed plugins and workspace layouts are always excluded.
- Optional remote subfolder.
- Detect per-file changes made remotely since the last successful sync and leave conflicts untouched.

It deliberately excludes attachments, deletes, automatic background sync, and conflict merging in this initial release. This makes its behavior conservative on mobile devices.

**First Pull speed** controls concurrent note checks. Keep the default of 4 on older iPads; try 6–8 on a recent iPad only if the initial baseline is slow. Higher values consume more memory and can encounter GitHub rate limits.

## Clone first, install later

This is supported. Clone or otherwise copy the repository into an Obsidian vault, then install and configure the plugin. On the first pull or push, identical local and GitHub notes are adopted as the sync baseline without being overwritten or committed. If the two copies differ, the plugin reports a conflict and preserves both copies. With **Sync Obsidian configuration** enabled (the default), safe JSON and CSS files in `.obsidian/` are synchronized. All `.obsidian/plugins/` contents—including Git Pad and BRAT—and device-specific `workspace*.json` files are always excluded.

## Set up

1. Create an empty GitHub repository, or choose a repository whose Markdown folder you want to sync.
2. Create a fine-grained GitHub personal access token limited to that repository, granting **Contents: Read and write**. This is sufficient for reading trees, creating blobs and commits, and advancing the configured branch. OAuth login with PKCE is planned; its resulting token can be selected here as well.
3. Install the plugin into your vault's `.obsidian/plugins/git-pad/` folder, then enable it under **Community plugins**.
4. In the plugin settings, enter the repository owner, name, branch, optional remote folder, and token.
5. Run **GitHub Sync: Pull Markdown from GitHub** once before editing. Use the pull and push commands from Obsidian's Command palette. When a note needs a pull or has a conflict, resolve it before pushing again.

## Development

Requires a current Node.js LTS release.

```bash
pnpm install
pnpm run dev
```

Use Obsidian's desktop mobile emulation for early testing, then test on a physical iPad. Build a release with `npm run build`.

## Security

The selected credential is held by Obsidian SecretStorage; the plugin saves only its secret name in `data.json`. Use a repository-scoped, least-privilege token and revoke it immediately if the device is lost or no longer trusted. Do not commit `data.json`.

### Network and account disclosure

This plugin makes HTTPS requests only to `api.github.com`. It uses GitHub's Git Database and repository Contents APIs to read Markdown notes, compare their revisions, and create commits in the repository you configure. A GitHub account and a repository-scoped credential are required. The plugin does not include telemetry, advertising, or a backend service, and it does not send vault files anywhere other than the selected GitHub repository.

## OAuth with PKCE

GitHub supports authorization-code OAuth with PKCE. The plugin should generate a high-entropy verifier and `state`, open GitHub's authorization URL with a SHA-256 `code_challenge`, validate the returned `state`, then exchange the code and original verifier for a bearer token. The bearer token works with the GitHub REST API used by this project; it is not an SSH key or native Git credential.

For a production iPad flow, register a GitHub OAuth app with an exact HTTPS callback URL that you control. The callback must return the authorization code to the plugin without ever receiving the verifier. The alternative GitHub Device Flow avoids callback routing but is less seamless. Do not embed an OAuth client secret in the plugin.

## Publishing

The GitHub release workflow creates releases containing `main.js`, `manifest.json`, and `styles.css`. To ship a version, run `pnpm run release patch` (or `minor` / `major`) from a clean, committed branch. The tag must exactly match the `version` in `manifest.json`.
