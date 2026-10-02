# 1. NATS JetStream as the broker

Status: accepted

## Context

The event-driven variant needs a durable broker with acknowledgements and redelivery. The lab has to run on a laptop without Docker, and in CI.

Options considered:

- **Kafka.** The most common choice in larger companies. Heavy to run locally (JVM, KRaft config), slow to start, and its consumer-group model adds concepts the lab does not need.
- **RabbitMQ.** Fine fit, but needs Erlang locally or a container.
- **A Postgres-backed queue** (a jobs table polled with `FOR UPDATE SKIP LOCKED`). No extra moving part, which is a real advantage. But it would make the event-driven variant look cheaper to operate than it usually is in practice, and it shares the database's failure domain, which hides the "broker is down" class of failures.
- **NATS JetStream.** A single static binary (about 20 MB RSS here), starts in milliseconds, has durable consumers, explicit acks, delayed redelivery (`nak(delay)`) and message de-duplication by id.

## Decision

NATS JetStream. The local runner downloads the pinned `nats-server` release binary into `.lab/bin`; docker-compose uses the official image.

## Consequences

- Message de-duplication (`msgID` + `duplicate_window`) covers relay retries after a crash. Consumers are still idempotent through an inbox table, because JetStream de-duplication does not cover redelivery of unacked messages.
- `ack_wait` sets a floor on recovery time after a consumer crashes: messages it held are handed out again only after `ack_wait`. With the NATS default of 30 s, the first (shorter, `--quick`) crash run took 28.8 s to recover. It is 10 s now (`ACK_WAIT_MS`), safely above the slowest handler (payment timeout 5 s).
- Results say nothing about Kafka throughput or operational cost. A Kafka variant is welcome as a contribution.
