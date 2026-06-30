# ADR 0001: Database selection

## Status
Accepted

## Context
We need to track changes and save logs for users, policies, and invoices. This data grows rapidly and has a dynamic structure, but we want to avoid managing a separate NoSQL infrastructure.

## Solution
We will use PostgreSQL as our primary relational database management system (RDBMS) to ensure data integrity and leverage strong relational mapping.

## Consequences
### Pros:
* Full ACID compliance for safe financial invoice processing
* Strong schema enforcement prevents corrupted user/policy data
* Excellent support for complex SQL joins across entities

### Cons:
* Harder to scale horizontally compared to NoSQL databases
* Schema migrations require careful planning as the team grows
