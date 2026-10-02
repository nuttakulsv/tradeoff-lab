# Results

Machine: Apple M2, 8 cores, 8 GB RAM, darwin 24.3.0, Node v22.17.0. Everything (PostgreSQL, NATS, the fake payment provider, the load generator) ran on this one machine.

## Scenarios

| Scenario | Variant | Orders done | Confirmed/s | Rejected | Errors | Answer p50 / p95 / p99 (ms) | POST p95 (ms) | Server p95 (ms) | Consistency |
|---|---|---:|---:|---:|---:|---|---:|---:|---|
| baseline-c1 | monolith | 308 | 15.4 | 0 | 0 | 65.6 / 70.3 / 74.5 | 70.2 | 61.2 | ok |
| baseline-c1 | microservices | 162 | 8.1 | 0 | 0 | 119.8 / 173.2 / 182.9 | 12.4 | 111.9 | ok |
| baseline-c16 | monolith | 5,602 | 279.7 | 0 | 0 | 56.2 / 62.7 / 70.2 | 62.6 | 58.7 | ok |
| baseline-c16 | microservices | 2,783 | 138.4 | 0 | 0 | 110.7 / 154.6 / 185.8 | 10.1 | 105.8 | ok |
| baseline-c64 | monolith | 22,858 | 1139.9 | 0 | 0 | 53.6 / 67.8 / 94.2 | 67.7 | 63 | ok |
| baseline-c64 | microservices | 9,195 | 456.3 | 0 | 0 | 124.4 / 191 / 307.2 | 25.5 | 136.2 | ok |
| hot-item | monolith | 40,085 | 10 | 39,985 | 0 | 7.4 / 10.9 / 14.4 | 10.9 | 3.8 | ok |
| hot-item | microservices | 4,767 | 9.9 | 4,667 | 0 | 57 / 115.7 / 281.6 | 20.3 | 41.9 | ok |
| slow-payment | monolith | 320 | 15.5 | 0 | 0 | 2048.4 / 2147.2 / 2158 | 2147.1 | 2038.3 | ok |
| slow-payment | microservices | 320 | 15.1 | 0 | 0 | 2082.9 / 2360.4 / 2416 | 92.2 | 2221.8 | ok |
| payment-outage | monolith | 5,822 | 183 | 320 | 0 | 56.7 / 476.6 / 498.5 | 476.4 | 463.9 | ok |
| payment-outage | microservices | 2,526 | 83.9 | 0 | 0 | 109.7 / 140.1 / 258 | 7.6 | 105 | ok |
| crash | monolith | 6,870 | 228.6 | 0 | 1,556 | 56.2 / 63.2 / 71 | 63.2 | 59.3 | ok |
| crash | microservices | 2,908 | 96.6 | 0 | 0 | 110.4 / 140.9 / 262.1 | 7.9 | 104.5 | ok |
| duplicates | monolith | 3,747 | 248.6 | 0 | 0 | 55.6 / 109.1 / 115.7 | 61.4 | 57.9 | ok |
| duplicates | microservices | 2,093 | 138.5 | 0 | 0 | 109.9 / 133.3 / 181.5 | 10.1 | 103.7 | ok |

"Answer" is the time a customer waits from POST until the order shows CONFIRMED or REJECTED, including polling every 50 ms when the API answers 202. "Server" is `updated_at - created_at` of finished orders, without the polling.

## Failures

| Scenario | Variant | Rejected (reason) | Errors seen by clients | Answers slower than 1 s | Longest wait (ms) | Recovery after restart |
|---|---|---|---:|---:|---:|---|
| slow-payment | monolith | 0 | 0 | 320 | 2,162.5 | n/a |
| slow-payment | microservices | 0 | 0 | 320 | 2,416.9 | n/a |
| payment-outage | monolith | 320 PAYMENT_UNAVAILABLE | 0 | 0 | 520.9 | n/a |
| payment-outage | microservices | 0 | 0 | 16 | 12,282.1 | n/a |
| crash | monolith | 0 | 1,556 | 0 | 162.2 | 5,910 ms |
| crash | microservices | 0 | 0 | 16 | 10,203.9 | 4,654 ms |

## Running cost on this machine

| Variant | Cold start (ms) | App memory idle / peak (MB) | Broker memory (MB) |
|---|---:|---|---:|
| monolith | 370 | 111 / 182 | 0 |
| microservices | 556 | 511 / 617 | 33 |

## Code and moving parts

| | Monolith | Microservices |
|---|---:|---:|
| Lines of TypeScript (own) | 411 | 707 |
| Lines shared by both (contract, SQL) | 375 | 375 |
| Deployable units | 1 | 5 |
| Containers in docker-compose | 3 | 8 |
| App environment variables | 3 | 16 |
| Databases | 1 | 4 |
| Message brokers | 0 | 1 |
| "Add a discount code": files / lines changed | 3 / 51 | 4 / 69 |
