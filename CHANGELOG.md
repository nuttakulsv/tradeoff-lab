# Changelog

## 0.1.0 - 2026-10-03

First release.

- Order system (place, cancel, get, list) built twice: a modular monolith and event-driven microservices on NATS JetStream, both NestJS 12 on PostgreSQL.
- One HTTP contract (`openapi.yaml`) and one black-box contract test suite that both variants pass.
- Lab runner without Docker (embedded PostgreSQL and a downloaded `nats-server`), plus docker-compose profiles for both variants.
- Scenarios: happy path at 1/16/64 customers, a hot item with 100 units, slow payment provider, payment outage, `kill -9` mid-order, duplicate requests and duplicate message delivery.
- Consistency checks from the databases and the payment provider's ledger after every scenario.
- Cost-of-change numbers and the "add a discount code" exercise as patches for both variants.
