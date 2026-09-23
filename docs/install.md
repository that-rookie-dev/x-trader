# Install (no Docker)

xTrader ships Node, the built apps, and PostgreSQL binaries inside a GitHub Release. Nothing is installed via Docker.

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

The script:

1. Detects `linux-x64`, `linux-arm64`, `darwin-arm64`, or `darwin-x64`
2. Unpacks into `$HOME/.xtrader` (override with `XTRADER_HOME`)
3. Writes `.env` if missing (session + encryption secrets only — no Kite keys in the file)
4. Installs a systemd user unit (Linux) or launchd agent (macOS)
5. Prints **http://localhost:3456**

On first open, xTrader shows a credentials screen. Paste your Kite Connect API key and secret; they are encrypted with AES-GCM in the local database. Revoke them later from **Settings**.

In the [Kite Connect](https://developers.kite.zerodha.com/apps) app, set Redirect URL exactly to:

`http://localhost:3456/zerodha/callback`

Bind address defaults to `127.0.0.1`. For a VPS, set `APP_BIND=0.0.0.0` and put the host behind Tailscale or SSH tunneling. Zerodha login is the only web authentication after credentials are saved.

## Recover a session

Click **Reconnect Zerodha** in the UI. Only the same linked client is accepted. To wipe cookies and expire broker sessions on the server:

```bash
~/.xtrader/bin/xtrader session reset
```

## Orders

xTrader never places paper or live orders. Whitelist / static IP is only relevant if you later change that product rule. Today the app only reads Kite data.
