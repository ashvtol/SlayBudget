# Releasing SlayBudget

A release is a universal macOS DMG on GitHub Releases plus the files the in-app updater reads. Installed copies check
for updates on launch and every 6 hours and show the changelog for every version since the one installed.

## Every release

1. **Write the notes** under `## [Unreleased]` in `CHANGELOG.md` (Added, Changed, Fixed, Removed). Plain language:
   people read these in the update dialog.
2. **Cut the version** on `main`:
   ```sh
   npm run release -- 0.2.0
   ```
   This dates the changelog (moving the Unreleased notes under `## [0.2.0] - today`), bumps the version in
   `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json` and `Cargo.toml`, and commits.
3. **Check**: `npm run check`.
4. **Publish and tag**:
   ```sh
   npm run publish:github -- --tag
   ```
   This copies `main` to the public repository as one commit (leaving out `tasks/`, `docs/superpowers/`,
   `docs/launch/` and `.claude/`), refuses if anything matches your git-ignored `.publish-blocklist`, pushes it, and
   pushes the `v0.2.0` tag.
5. **Wait for the workflow** (`.github/workflows/release.yml`, about 15 minutes). It builds the DMG and the signed
   updater files, uses the changelog section as the release text, and puts the full changelog into `latest.json`.
6. **Publish the draft release** on GitHub after a quick look. Installed apps see the update once it's published.

Without `--tag`, `npm run publish:github` only updates the public code (for README or docs changes).

## One-time setup

- **Updater signing key**: the private key is at `~/.tauri/slaybudget.key` and its public half is in
  `src-tauri/tauri.conf.json`. Add the private key to the public repository's secrets (Settings > Secrets and
  variables > Actions):
  - `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/slaybudget.key` (`pbcopy < ~/.tauri/slaybudget.key`)
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: leave it empty (the key has no password)

  **Back the key up** (a password manager is ideal). If it's lost, installed copies can't verify new updates and
  everyone has to download the next version by hand.
- **`.publish-blocklist`** (git-ignored): one case-insensitive pattern per line, such as your name, email and account
  digits.

## Later: Apple notarization

To remove the first-launch "Open Anyway" step, join the Apple Developer Program and add these secrets:
`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and
`APPLE_TEAM_ID`. Then pass them in the workflow's `env` and remove `"signingIdentity": "-"` from `tauri.conf.json`.
