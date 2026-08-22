# GitHub Sync Mobile for Obsidian

A mobile-first Obsidian plugin that synchronizes Markdown files with a GitHub repository through the GitHub API. It works on iPadOS because it does not rely on native Git, Node.js, Electron, or SSH.

## Current scope

- Pull Markdown files from a repository branch into the vault.
- Push changed Markdown files as one GitHub commit.
- Optional remote subfolder.
- Detect per-file changes made remotely since the last successful sync and leave conflicts untouched.

It deliberately excludes attachments, deletes, automatic background sync, and conflict merging in this initial release. This makes its behavior conservative on mobile devices.

## Clone first, install later

This is supported. Clone or otherwise copy the repository into an Obsidian vault, then install and configure the plugin. On the first pull or push, identical local and GitHub notes are adopted as the sync baseline without being overwritten or committed. If the two copies differ, the plugin reports a conflict and preserves both copies. Plugin settings in `.obsidian/` are never synchronized because only Markdown files are in scope.

## Set up

1. Create an empty GitHub repository, or choose a repository whose Markdown folder you want to sync.
2. Create a fine-grained GitHub personal access token limited to that repository, granting **Contents: Read and write**. This is sufficient for reading trees, creating blobs and commits, and advancing the configured branch. OAuth login with PKCE is planned; its resulting token can be selected here as well.
3. Install the plugin into your vault's `.obsidian/plugins/github-sync-mobile/` folder, then enable it under **Community plugins**.
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

## OAuth with PKCE

GitHub supports authorization-code OAuth with PKCE. The plugin should generate a high-entropy verifier and `state`, open GitHub's authorization URL with a SHA-256 `code_challenge`, validate the returned `state`, then exchange the code and original verifier for a bearer token. The bearer token works with the GitHub REST API used by this project; it is not an SSH key or native Git credential.

For a production iPad flow, register a GitHub OAuth app with an exact HTTPS callback URL that you control. The callback must return the authorization code to the plugin without ever receiving the verifier. The alternative GitHub Device Flow avoids callback routing but is less seamless. Do not embed an OAuth client secret in the plugin.

## Publishing

The GitHub release workflow creates releases containing `main.js`, `manifest.json`, and `styles.css`. To ship a version, run `pnpm run release patch` (or `minor` / `major`) from a clean, committed branch. Replace the author fields in `manifest.json` before the first public release.
