# ADR 0006: Architecture and Tech Stack for Management Backoffice Service

## Status
Accepted

## Context
We need an administrative backoffice platform for internal managers to handle user management, configure policies, and track invoice processing statistics. This service requires high-density UI components (dashboards, tables, forms), complex data querying from the primary PostgreSQL database, and separate deployments for front-end assets and API layers.

## Solution
We will implement the Management service as a decoupled monolith within a single repository, split into two layers:
1. **Backend**: Node.js (with Express/NestJS) connecting directly to the PostgreSQL database for rapid data manipulation and statistics aggregation.
2. **Frontend**: Vue.js 3 (Composition API) for a responsive, component-driven administrative interface.

## Consequences
### Pros:
* Vue 3 provides excellent reactivity and performance for data-heavy dashboards and dynamic tracking tables.
* Direct PostgreSQL connection eliminates Dapr overhead for complex analytical SQL queries and reporting.
* Node.js shares the JavaScript/TypeScript ecosystem with Vue 3, allowing full-stack development and potential code/type sharing.
* Simple development workflow with both frontend and backend code residing in one logical service folder.

### Cons:
* Bypassing the Dapr abstraction layer means the Management backend is tightly coupled specifically to PostgreSQL.
* Direct analytical queries on the primary database could impact performance during heavy write traffic from the Ingestion service (mitigated by optimizing indexes or using read-replicas later).
