# 4. Share the contract and SQL between the variants

Status: accepted

## Context

If the two variants were written independently, differences in results could come from code quality rather than architecture: one has a better index, the other a slower validation library.

## Decision

`src/shared/` holds the request schemas, the order/stock/payment SQL and the payment client. Each variant decides how those pieces are wired: one transaction or many, synchronous calls or events, one database or four.

## Consequences

- The comparison is about structure, not about who wrote the better query.
- It flatters the microservices variant in the code-change exercise: the gateway reuses the shared request schema, so adding a field needed no gateway change. In a polyrepo setup with separately versioned services it would.
- Shared code between services is itself a coupling most microservice teams avoid. The lab accepts it for fairness and says so.
