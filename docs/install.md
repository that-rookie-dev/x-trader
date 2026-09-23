# Install (no Docker)

xTrader ships a built Node app and PostgreSQL binaries inside a GitHub Release. Nothing is installed via Docker. **Node.js 20.11+** must already be on your PATH.

## From a release

```bash
curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/install.sh | bash
```

Or download and run:

```bash
curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/install.sh -o install.sh
chmod +x install.sh
./install.sh
```

Pin a version:

```bash
XTRADER_VERSION=v0.1.0 bash install.sh
```

The script:

1. Detects `linux-x64`, `linux-arm64`, `darwin-arm64`, or `darwin-x64`
2. Unpacks into `$HOME/.xtrader` (override with `XTRADER_HOME`)
3. Writes `.env` if missing (session + encryption secrets only — no Kite keys in the file)
4. Installs a systemd user unit (Linux) or launchd agent (macOS)
5. **Auto-starts** API + web UI and waits until http://localhost:3456 answers
6. Opens the desk in your default browser when ready

On first open, xTrader shows a credentials screen. Paste your Kite Connect API key and secret; they are encrypted with AES-GCM in the local database. Revoke them later from **Settings**.

In the [Kite Connect](https://developers.kite.zerodha.com/apps) app, set Redirect URL exactly to:

`http://localhost:3456/zerodha/callback`

Bind address defaults to `127.0.0.1`. For a VPS, set `APP_BIND=0.0.0.0` (and matching `APP_ORIGIN`) in `~/.xtrader/.env`, then put the host behind Tailscale or SSH tunneling. Zerodha login is the only web authentication after credentials are saved.

## CLI

```bash
~/.xtrader/bin/xtrader start           # API (:4000) + UI (:3456) + bundled Postgres
~/.xtrader/bin/xtrader update          # download latest release and restart
~/.xtrader/bin/xtrader session reset   # revoke cookies / expire broker sessions
~/.xtrader/uninstall.sh                # stop services + delete app and all data
```

When a newer GitHub Release exists, the UI shows an **Update available** banner. **Update & restart** runs the same self-update path (preserves `.env` and `var/`), then brings the desk back up.

## Uninstall

Wipes the install directory (app binaries, Postgres data, paper wallet, encrypted Kite vault, logs) and removes launchd/systemd units:

```bash
curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/uninstall.sh | bash
```

Or run `~/.xtrader/uninstall.sh`. Non-interactive: `XTRADER_UNINSTALL_YES=1 bash uninstall.sh`.
## Recover a session

Click **Reconnect Zerodha** in the UI. Only the same linked client is accepted. To wipe cookies and expire broker sessions on the server:

```bash
~/.xtrader/bin/xtrader session reset
```

## From source (developers)

```bash
cp .env.example .env
# add SESSION_SECRET and TOKEN_ENCRYPTION_KEY_BASE64 (see README)
npm install
npm run build
npm start
```

`npm start` runs the API, which also spawns the Next standalone UI when `apps/web/.next/standalone` exists.

## Publishing a release (maintainers)

```bash
git tag v0.1.0
git push origin v0.1.0
```

The `release` workflow builds four platform tarballs (`linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64` on `macos-15-intel`) plus `install.sh` and attaches them to the GitHub Release.

Local dry-run after `npm run build`:

```bash
bash scripts/pack-release.sh darwin-arm64
```

## Orders

xTrader never places paper or live orders. Whitelist / static IP is only relevant if you later change that product rule. Today the app only reads Kite data.
