# xTrader

Personal AI-assisted trading system. Product name is **xTrader**; package name is `xtrader`.

Default execution is **TEST (paper)**. Live Zerodha orders stay disabled until you confirm a static egress IP in Settings **and** whitelist that IP in the Kite developer console.

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

Open `http://127.0.0.1:3000`. Click **Connect Zerodha**. xTrader never collects your Kite password or OTP.

## CLI

```bash
npm run cli -- session reset   # recover a lost browser cookie on a linked instance
npm run cli -- start           # API + bundled Postgres
```

## Safety

- AI profiles cannot call broker order APIs.
- Paper cash/positions are stored separately from real holdings.
- LIVE mode requires: Settings toggle, confirmed egress IP matching the current public IP, no halt, healthy broker session.
- Autonomous LIVE is default-off.
- If the browser cookie expires, click **Reconnect Zerodha**. Only the same linked client is accepted. Use `xtrader session reset` only to wipe sessions on the server.

## Tests

```bash
npm test
```

Real-account login is **unverified** until you complete Kite Connect in the browser.

## Install on a server (no Docker)

See [docs/install.md](docs/install.md). `scripts/install.sh` unpacks a GitHub Release and starts a systemd/launchd unit.

## Layout

- `apps/api` — Express trading runtime
- `apps/web` — Next.js dashboard
- `packages/domain` — broker-neutral contracts
