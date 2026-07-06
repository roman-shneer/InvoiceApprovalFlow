# ADR 0003: Declarative Traffic Control and Rate Limiting via Dapr Middleware

## Context
High-throughput API endpoints, such as the Ingestion service (`/api/v1/expenses`), are inherently vulnerable to unpredictable traffic spikes, distributed denial-of-service (DDoS) events, and upstream resource exhaustion. Hardcoding rate-limiting logic inside the Node.js Express application source code introduces maintenance drag, tight coupling between business logic and infrastructure concerns, and consumes precious single-threaded CPU cycles parsing request volumes before validation occurs.

## Decision
We implement programmatic traffic throttling at the infrastructure boundary using declarative Dapr HTTP rate-limiting middleware. The configuration defines an explicit maximum threshold of requests per second per node. It is mounted directly into the Dapr sidecar runtime pipeline, intercepting payloads before they hit the application layer.

## Consequences
*   **Positive:** Complete decoupling of traffic management and cybersecurity constraints from core JavaScript application code.
*   **Positive:** Immediate resource protection; unauthorized or excess requests are dropped at the sidecar level, preventing Express process thread starvation.
*   **Positive:** Standardized error handling through consistent propagation of `429 Too Many Requests` status codes down to client runtimes.
*   **Negative:** Adds a declarative configuration dependency (`rate-limit.yaml`) that must be synchronized across local Docker Compose setups and production orchestration topologies.
