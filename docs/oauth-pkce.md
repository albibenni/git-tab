# GitHub OAuth PKCE design

## What it solves

OAuth PKCE lets a user authorize GitHub from Obsidian without creating and pasting a personal access token. The access token is then used as a bearer token for the GitHub REST API. It is suitable for this plugin's API-based synchronization; it does not provide native Git, SSH, or command-line credentials.

## Required setup

Create a GitHub OAuth App and configure an exact HTTPS callback URL you control. Keep the public `client_id` in plugin settings or source. Never ship the client secret in the Obsidian plugin. For a broadly distributed plugin, use a GitHub App where its permission model and short-lived user tokens better match repository-scoped access.

## Flow

1. Generate a cryptographically random `code_verifier` (43–128 URL-safe characters) and a separate random `state`.
2. Hash the verifier with SHA-256 and Base64URL-encode it to form `code_challenge`.
3. Open `https://github.com/login/oauth/authorize` with `client_id`, `redirect_uri`, `state`, `code_challenge`, and `code_challenge_method=S256`.
4. The callback relays the `code` and `state` back to the waiting plugin. Validate that `state` exactly matches before continuing.
5. Send `client_id`, `code`, `redirect_uri`, and `code_verifier` to `https://github.com/login/oauth/access_token`, requesting JSON.
6. Store the resulting access token in Obsidian SecretStorage and retain only the returned secret name in plugin settings.

## iPad callback choices

An Obsidian plugin should not assume it can claim its own iOS URL scheme. The dependable option is an HTTPS callback page you control. It can display a short, one-time handoff code that the plugin polls from your backend, or it can return the code to a plugin-supported Obsidian URI after verifying that this works on physical iPad hardware. The PKCE verifier stays only in the plugin in both designs.

GitHub Device Flow is a sensible fallback for iPad: show the user code and open the verification page, then poll at GitHub's required interval. It avoids redirects and does not require a client secret, but needs Device Flow enabled in the GitHub app registration.
