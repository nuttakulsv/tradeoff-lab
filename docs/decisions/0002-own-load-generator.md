# 2. A small closed-loop load generator instead of autocannon or k6

Status: accepted

## Context

The interesting number in this lab is not "how fast does POST /orders return". In the event-driven variant POST returns 202 in a few milliseconds, which looks great and tells you nothing: the customer is still waiting for CONFIRMED or REJECTED.

autocannon measures request latency only. k6 can poll, but needs its own binary and scripting in another runtime, and the lab already needs to read the databases afterwards to check consistency.

## Decision

`harness/load.ts`: N virtual customers, each places an order, polls `GET /orders/:id` every 50 ms until the status is final, then places the next one (closed loop). It records request latency, time to a final answer, and every outcome.

## Consequences

- Time to a final answer includes up to 50 ms of polling granularity in the 202 variant. The report also shows server-side time (`updated_at - created_at`) without polling, so readers can subtract it.
- Closed loop means throughput is bounded by latency. When something slows down, fewer orders are attempted, as with real customers. Open-loop (fixed arrival rate) testing is not covered.
- The generator runs on the same machine as the system under test and takes CPU from it.
