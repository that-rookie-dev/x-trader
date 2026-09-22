# Architecture

xTrader is a modular monolith.

- Browser → Next.js (`:3000`) → Express API (`:4000` in dev, same origin in a release)
- Bundled PostgreSQL on loopback
- Broker ports: `BrokerReadClient`, `BrokerMarketDataClient`, `BrokerOrderClient`, `ExecutionAdapter`
- Only the execution module may hold a `BrokerOrderClient`
- AI SDK profiles produce schema-validated `TRADE` / `NO_TRADE` intents
- Risk engine is deterministic and has no LLM dependence
- TEST uses `PaperExecutionAdapter`; LIVE uses `ZerodhaOrderAdapter` behind `LiveGate`

Future brokers (Groww, Upstox, Angel One, IB) implement the same ports. Do not add empty stub adapters.
