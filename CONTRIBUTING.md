# Contributing

Issues and pull requests are welcome, in English or Thai.

## Setup

```bash
npm install
npm test                     # unit tests, start a throwaway PostgreSQL
npm run lab -- contract all  # contract tests against both variants
```

Node 22.12 or newer. No Docker needed; the first run downloads `nats-server` into `.lab/bin`.

## Ground rules for numbers

- Never edit numbers in the README by hand. Run the scenarios, then `npm run lab -- report`, and copy from `results/summary.md`.
- Say which machine you ran on. Results from different machines are not comparable.
- If a change makes one variant faster, check that it would be fair to apply the same idea to the other one.

## Adding an architecture

The most useful contributions are new variants: synchronous microservices over HTTP, a Kafka-based variant, a serverless one.

1. Put the code under `src/<variant>/`. Reuse `src/shared/` for schemas and SQL so the comparison stays about structure.
2. Expose the API in `openapi.yaml` on one port.
3. Add it to `harness/variants.ts` (processes, ports, databases, which process the crash scenario kills).
4. Make `npm run lab -- contract <variant>` pass.
5. Add a compose profile and the variant to the CI matrix.
6. Write the exercise patch for it (`exercises/discount-code/<variant>.patch`).

## Adding a scenario or an exercise

Scenarios live in `harness/scenarios.ts`. A new failure mode should come with a check in `harness/check.ts` if it can break something the existing checks don't see.

An exercise is a feature implemented once per variant and stored as a patch. It must apply to `main` and pass the contract tests, which CI checks. A change that crosses contexts (for example, product names in the confirmation notification) is the obvious next one.

## Style

Prettier and oxlint run in CI (`npm run lint`, `npm run format:check`). Keep comments for the why, not the what.
