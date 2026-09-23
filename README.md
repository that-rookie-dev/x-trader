# xTrader

Personal analysis / forecast desk for Indian F&O and stocks. **Never places orders** — you trade in the Zerodha app; xTrader analyses, instructs, and learns from fills it reads back.

## Install (recommended)

Requires **Node.js 20.11+** (the installer downloads a local copy automatically if Node is missing). No Docker — PostgreSQL is bundled.

```bash
curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/install.sh | bash
```

The installer **starts the desk automatically** and opens **http://localhost:3456** when it’s ready. On first load, paste your Kite Connect API key and secret (stored encrypted locally).

In the [Kite Connect](https://developers.kite.zerodha.com/apps) app, set Redirect URL exactly to:

`http://localhost:3456/zerodha/callback`

Full notes, upgrades, and session recovery: [docs/install.md](docs/install.md).

```bash
# optional overrides
# XTRADER_HOME=~/.xtrader XTRADER_VERSION=v0.1.0 bash install.sh
~/.xtrader/bin/xtrader start          # API + UI + bundled Postgres
~/.xtrader/bin/xtrader update         # apply latest GitHub release and restart
~/.xtrader/bin/xtrader session reset  # wipe app cookies / expire broker sessions
```

The UI also shows an update banner when a newer release is published.

## Uninstall

Removes the app, launch agent/systemd unit, and **all local data** (`~/.xtrader` including Postgres + vault):

```bash
curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/uninstall.sh | bash
# or: ~/.xtrader/uninstall.sh
```
## Run from source

```bash
git clone https://github.com/that-rookie-dev/x-trader.git
cd x-trader
cp .env.example .env
echo "SESSION_SECRET=$(openssl rand -base64 48)" >> .env
echo "TOKEN_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)" >> .env
npm install
npm run build
npm start                 # API + web UI on :4000 / :3456
```

Open `http://localhost:3456`. Do not put Kite keys in `.env` — use the first-run UI.

```bash
npm test
npm run cli -- session reset
```

## Safety

- Analysis desk only — no live or paper order placement from this app.
- AI profiles cannot call broker order APIs.
- Zerodha is read-only (quotes, funds, holdings, positions, orders for reconcile).
- If the browser cookie expires, click **Reconnect Zerodha**.

## Docs

- [Install](docs/install.md)
- [Architecture](docs/architecture.md)
- [Phase status](docs/phase-status.md)

## Layout

- `apps/api` — Express desk runtime + CLI
- `apps/web` — Next.js dashboard (standalone)
- `packages/domain` — shared contracts
- `scripts/install.sh` / `uninstall.sh` / `pack-release.sh` — GitHub Release bundle
