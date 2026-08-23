# Git Pad

Git Pad is a mobile-first Obsidian plugin that synchronizes notes with one GitHub repository through the GitHub REST API. It is designed for iPadOS: it does not require native Git, Node.js, Electron, SSH, or a local `.git` directory.

## What it does

| Capability | Behavior |
| --- | --- |
| Pull from GitHub | Downloads changed supported files from the selected branch into the vault. |
| Commit and push | Creates one Git commit containing local changes, then advances the selected branch. |
| Clone into a blank vault | Copies every tracked repository file, including attachments and `.obsidian`, into an empty vault. |
| Fast repeat pulls | Remembers the last successful commit and compares it with the current head, so an unchanged repository avoids a full index and per-note scan. |
| Safe first pull | Existing local files identical to GitHub are adopted without being rewritten. Different files are preserved as conflicts. |
| Force GitHub Pull | Optional one-way mode that replaces every synced GitHub file with the remote version. |
| iPad progress and recovery | Shows the current file and completed progress; network, read, and hash stages time out after 60 seconds with a visible error. |
| Repository status | The sidebar shows the current head, recent commits, and how many commits are ahead of the local sync baseline. |

## Commands

- **Git Pad: Open sidebar** — opens the repository status, Pull, and Commit & Push controls.
- **Git Pad: Clone repository into this blank vault** — copies the complete configured repository into an empty vault.
- **Git Pad: Pull Markdown from GitHub** — applies remote changes to the vault.
- **Git Pad: Push Markdown to GitHub** — creates and pushes one commit containing local changes.

## Files that sync

### Markdown

All Markdown files (`.md`) outside Obsidian’s configuration directory are in scope. An optional **Remote folder** limits syncing to a repository subfolder.

### Obsidian configuration

**Sync Obsidian configuration** is enabled by default. It includes these safe, shareable paths:

- Core settings such as `app.json`, `appearance.json`, `hotkeys.json`, `bookmarks.json`, `graph.json`, `daily-notes.json`, `templates.json`, and other supported core-pane settings.
- `community-plugins.json` and `core-plugins.json`, so the enabled-plugin list can be shared.
- CSS snippets in `.obsidian/snippets/`.
- Theme CSS and theme `manifest.json` files in `.obsidian/themes/`.

The following are never synchronized:

- `.obsidian/plugins/**`, including Git Pad, BRAT, and every other installed plugin.
- Workspace, cache, and other device-specific configuration files.
- Attachments, binaries, and non-Markdown vault files.

This means the iPad’s installed plugin code and plugin settings are not overwritten by Pull or included in Push.

## Pull behavior

### First Pull or fallback Pull

Git Pad fetches a recursive GitHub tree and checks each supported remote file. This is used when there is no prior successful sync, after rewritten/diverged Git history, or when GitHub’s commit comparison is too large to trust as a complete file list.

### Incremental Pull

After a successful sync, Git Pad stores the exact GitHub commit SHA. The next Pull compares that SHA with the branch head and checks only files changed on GitHub since that commit.

An unchanged repository requires only a head lookup and commit comparison. The Pull is pinned to one head SHA, so files cannot be read from a mixture of two remote commits if GitHub changes during the operation.

Remote deletions are currently non-destructive: Git Pad leaves a local file in place if it no longer exists on GitHub.

### Conflicts

Git Pad does not overwrite a file when both the local and remote versions may contain changes. It reports a conflict and preserves the local version. Exact conflicting paths are written to Obsidian’s developer console.

A conflict can occur even when you did not consciously edit a note: another plugin may have changed frontmatter or Markdown, line endings may differ, or the local vault may not match the selected repository folder.

### Force GitHub files on Pull

Enable **Force GitHub files on Pull** only when GitHub is the source of truth. The next Pull replaces every synced file that exists on GitHub, records GitHub’s revision as the new baseline, and avoids conflicts for those files.

It does **not** delete local-only files. Disable the setting after recovery if you want normal conflict protection again.

## Clone a repository into a blank vault

Use **Clone repository into this blank vault** when creating a new vault from GitHub. It uses the configured owner, repository, and branch, then copies every tracked blob at one pinned commit:

- Markdown, attachments, and other binary files are copied.
- `.obsidian` is copied, including themes, snippets, and plugin folders such as BRAT and Git Pad.
- The configured **Remote folder** must be empty because Clone always copies the complete repository root.
- The vault must contain no files outside `.obsidian`; this protects an existing vault from accidental overwrite.
- Existing `.obsidian` files may be replaced. If the repository includes Git Pad itself, reload Obsidian after Clone to activate the cloned plugin files.

Clone saves the cloned commit as the sync baseline. Later Pull and Push operations retain their normal selective-file behavior; they do not begin syncing attachments or plugin files just because Clone initially copied them.

## Push behavior

Push scans supported local files, detects local and remote changes from the saved baseline, then creates one GitHub commit for all safe changes. It does not push if a file needs a Pull first or has a conflict. GitHub branch updates use non-force updates; a concurrent remote change therefore fails safely rather than overwriting another device’s commit.

## Settings

| Setting | Description |
| --- | --- |
| Repository owner | GitHub user or organization. |
| Repository name | GitHub repository name. |
| Branch | Branch to pull from and push to; normally `main`. |
| Remote folder | Optional repository subfolder mapped to the vault root. |
| First Pull speed | Concurrent Pull checks, from 1 to 12. Keep 2–4 on older iPads; use 6–8 only on recent devices. |
| Sync Obsidian configuration | Includes the supported `.obsidian` settings, snippets, and themes described above. |
| Force GitHub files on Pull | Replaces synced files with GitHub versions during Pull; local-only files remain. |
| GitHub credential | A named secret stored in Obsidian SecretStorage. |

## Clone first, install later

This workflow is supported. Copy or clone the repository into an Obsidian vault, then install Git Pad and configure it. On the first Pull or Push, exact local/GitHub matches are adopted as the baseline without rewriting or committing them. Differing files are reported as conflicts instead of being silently replaced.

## Setup

1. Create or choose a GitHub repository.
2. Create a fine-grained personal access token limited to that repository with **Contents: Read and write** permission.
3. Install and enable Git Pad under **Community plugins**.
4. Enter the repository owner, name, branch, optional remote folder, and credential in Git Pad settings.
5. Run **Pull Markdown from GitHub** before editing when GitHub is the source of truth. Use Force GitHub Pull only if you explicitly want the remote copy to win.

## Limits and safety model

- Git Pad is GitHub-only; it does not support arbitrary Git remotes, SSH, branches beyond the configured branch, staging, submodules, or native Git operations.
- It does not yet synchronize deletions, perform three-way merges, or provide a visual conflict resolver.
- Sync runs are manual. There is no automatic background pull or push.
- GitHub requests and local per-file work have a 60-second visible timeout. Obsidian’s mobile HTTP API does not expose request cancellation, so a timed-out native request may finish in the background, but Git Pad stops advancing the sync operation.
- A recursive GitHub tree that GitHub marks as truncated is rejected rather than synced incompletely. Choose a smaller Remote folder in that case.

## Security and privacy

The selected credential is held by Obsidian SecretStorage; Git Pad saves only its secret name in plugin data. Use a least-privilege, repository-scoped token and revoke it if the device is lost.

Git Pad makes HTTPS requests only to `api.github.com`. It sends supported vault files only to the configured GitHub repository. It has no telemetry, advertising, or backend service.

## Development

Requires a current Node.js LTS release.

```bash
pnpm install
pnpm test
pnpm build
pnpm lint
```

Use Obsidian’s mobile emulation for early testing, then validate on a physical iPad.

## Release and BRAT

The release workflow publishes `main.js`, `manifest.json`, and `styles.css`. BRAT installs only a published GitHub release, so an iPad does not receive local source changes until a new release is created.

From a clean, committed branch:

```bash
pnpm run release patch
```

Use `minor` or `major` instead of `patch` when appropriate. The Git tag must match `manifest.json`.
