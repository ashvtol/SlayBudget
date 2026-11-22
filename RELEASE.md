# Releasing SlayBudget

Builds and releases are produced by `.github/workflows/release.yml` on every
`v*` tag (e.g. `git tag v0.2.0 && git push origin v0.2.0`). The workflow builds a
universal macOS app on `macos-14` and uploads a draft GitHub Release.

## One-time: enable auto-update

The in-app updater (Settings → Updates) needs a signing key and a few config
additions. This is a one-time setup on your Mac.

1. **Generate a signing key**

   ```bash
   npm run tauri signer generate -- -w ~/.tauri/slaybudget.key
   ```

   This prints a **public key** and writes the private key to the path given.
   Keep the private key secret.

2. **Add the public key to `src-tauri/tauri.conf.json`** under a new `plugins`
   block, and point the updater at the GitHub Releases endpoint:

   ```json
   "plugins": {
     "updater": {
       "endpoints": [
         "https://github.com/<owner>/<repo>/releases/latest/download/latest.json"
       ],
       "pubkey": "<PASTE THE PUBLIC KEY HERE>"
     }
   }
   ```

3. **Add the updater target** to `bundle` in the same file:

   ```json
   "bundle": { "createUpdaterArtifacts": true }
   ```

4. **Add the Rust plugins** in `src-tauri/Cargo.toml`:

   ```toml
   tauri-plugin-updater = "2"
   tauri-plugin-process = "2"
   ```

   and register them in `src-tauri/src/lib.rs`:

   ```rust
   .plugin(tauri_plugin_updater::Builder::new().build())
   .plugin(tauri_plugin_process::init())
   ```

   (The JS packages `@tauri-apps/plugin-updater` and `@tauri-apps/plugin-process`
   are already in `package.json`, and the Updates pane already calls them.)

5. **Add the updater capability** in `src-tauri/capabilities/default.json`:

   ```json
   "updater:default", "process:allow-restart"
   ```

6. **Add GitHub repository secrets** (Settings → Secrets → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/slaybudget.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you set (blank if none)

Once these are in place, tagging a release produces signed updater artifacts and
a `latest.json`; the installed app will offer the update from Settings → Updates.

## Code signing & notarization (optional, removes Gatekeeper warnings)

To ship outside your own machine without the "unidentified developer" prompt,
add an Apple Developer ID certificate and notarization credentials as secrets
(`APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`) and pass them through in the
workflow env. Until then, the app runs locally fine (right-click → Open the
first time).
