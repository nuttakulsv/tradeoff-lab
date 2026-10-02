# 3. What is in scope for v0.1

Status: accepted

## In scope

- Two architectures of the same small order system, behind one HTTP contract.
- Load at a few concurrency levels, and failure scenarios that matter for money and stock: slow provider, provider outage, a crash in the middle of an order, duplicate requests and duplicate message delivery.
- Checking consistency from the databases and the payment provider's ledger, not from API responses.
- Static cost of change: lines of code, moving parts, and a scripted feature change.

## Out of scope

- Kubernetes, service meshes, autoscaling. Both variants run as plain processes or containers.
- Caching, read replicas, CQRS read models.
- Authentication, multi-tenancy, multi-region.
- Synchronous microservices (HTTP between services). It is a real and common design, and a good next variant to contribute.
- Real cloud deployments. Cost numbers are estimates from public price lists.

## Why

Each extra dimension multiplies the number of runs and the ways results can be misread. v0.1 keeps one variable: how the system is split and how its parts talk.
