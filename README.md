# xTrader

Personal analysis / forecast desk for Indian F&O and stocks. Product name is **xTrader**; package name is `xtrader`.

**This app never places orders** (paper or live). It analyses markets, issues order instructions, and learns from fills it reads back from Zerodha. You execute every trade in the Zerodha app.

## Requirements

- Node.js 20.11+
- No Docker. PostgreSQL is bundled via `embedded-postgres` and listens on `127.0.0.1` only.

## Setup

```bash
cd xTrader
cp .env.example .env
```

Generate secrets (do not commit `.env`):

```bash
echo "SESSION_SECRET=$(openssl rand -base64 48)" >> .env
echo "TOKEN_ENCRYPTION_KEY_BASE64=$(openssl rand -base64 32)" >> .env
```

Kite API key and secret are entered in the **first-run UI** (encrypted vault). Do not put them in `.env`.

In your Kite Connect app, set the redirect URL exactly to:

`http://localhost:3456/zerodha/callback`

```bash
npm install
npm run build -w @xtrader/domain
npm test
```

## Run (production)

Build once, then start API and web:

```bash
npm run build
```

Terminal 1:

```bash
npm run start:api
```

Terminal 2:

```bash
npm run start:web
```

Open `http://localhost:3456`, enter Kite credentials if prompted, then connect Zerodha. Use Options / Stocks for instructions; dismiss plays after you trade. Revoke API credentials later from **Settings**.

`npm run dev:api` / `npm run dev:web` also start production (not Next/tsx watch).

## CLI

```bash
npm run cli -- session reset   # recover a lost browser cookie on a linked instance
npm run cli -- start           # API + bundled Postgres
```

## Safety

- Analysis desk only — no COPILOT/AUTO or LIVE order path.
- AI profiles cannot call broker order APIs.
- Zerodha is read-only (quotes, funds, holdings, positions, orders for reconcile).
- If the browser cookie expires, click **Reconnect Zerodha**.

## Tests

```bash
npm test
```

## Install on a server (no Docker)

```bash
curl -fsSL https://github.com/that-rookie-dev/x-trader/releases/latest/download/install.sh | bash
```

Then open **http://localhost:3456**. Full notes: [docs/install.md](docs/install.md).

## Docs

- [Install](docs/install.md)
- [Architecture](docs/architecture.md)
- [Phase status](docs/phase-status.md)

## Layout

- `apps/api` — Express desk runtime
- `apps/web` — Next.js dashboard
- `packages/domain` — shared contracts
