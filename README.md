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

Set `KITE_API_KEY`, `KITE_API_SECRET`, and optionally `KITE_ALLOWED_CLIENT_ID`.
The Kite app redirect URL must be exactly:

`http://127.0.0.1:3000/zerodha/callback`

```bash
npm install
npm run build -w @xtrader/domain
npm test
```

## Run (development)

Terminal 1:

```bash
npm run dev:api
```

Terminal 2:

```bash
npm run dev:web
```

Open `http://127.0.0.1:3000`, connect Zerodha, use Options / Stocks for instructions, dismiss plays after you trade.

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

See [docs/install.md](docs/install.md).

## Docs

- [Install](docs/install.md)
- [Architecture](docs/architecture.md)
- [Phase status](docs/phase-status.md)

## Layout

- `apps/api` — Express desk runtime
- `apps/web` — Next.js dashboard
- `packages/domain` — shared contracts
