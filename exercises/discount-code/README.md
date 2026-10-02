# Exercise: add a discount code

The feature: `POST /orders` accepts an optional `discountCode`. `WELCOME10` takes 10% off the amount that is charged. An unknown code is a 400 before any stock is taken.

Each variant has its own patch against `main`. Both add the same contract test (`contract/discount.contract.ts`).

```bash
git apply exercises/discount-code/monolith.patch
npm run build && npm run lab -- contract monolith
git checkout -- src contract && git clean -fdq contract
```

Same for `microservices.patch`. CI does exactly this on every push.

## What changed

|                                                      | Monolith                                                    | Microservices                                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Shared (`src/shared/contract.ts`, `orders-store.ts`) | schema field, column, codes table                           | same                                                                                                            |
| Variant code                                         | `orders.service.ts`: check the code, apply it after pricing | `orders/main.ts`: check the code at POST; `saga.ts`: apply it when stock is reserved, before asking for payment |
| Files / lines changed in `src/`                      | 3 / 51                                                      | 4 / 69                                                                                                          |

In the monolith the price and the discount meet inside one function and one transaction. In the event-driven variant the price arrives in an event from inventory, so the discount has to be applied in the saga step that reacts to it, and the order row has to remember the code until then.

The gateway needed no change because it reuses the shared request schema. With separately versioned services it would need its own change and a deploy in the right order ([ADR 4](../../docs/decisions/0004-shared-code.md)).
