# ADR 0002: Ingestion Service Technology Stack & Direct Persistence Pattern

## Status
Accepted

## Context
The system receives a high volume of webhooks and invoice ingestion requests from external clients. This traffic is highly unpredictable and spikes during peak hours. Our initial architecture risked losing data if downstream processing services were temporarily unavailable or slow.

Furthermore, with the introduction of the `orchestrator-service` (ADR 0010), the ingestion layer needs to act strictly as an entry point: validating request payloads, ensuring idempotency, and persisting valid invoices directly into the primary state store (`mongo-invoices`) without coupling itself to downstream event streams or processing rules.

## Solution
We will implement the Ingestion service using **Node.js** paired with Dapr sidecar integration:
1. **Asynchronous Execution:** Leverages Node.js non-blocking I/O to handle heavy request volume without blocking the event loop.
2. **Idempotency Guard:** Interacts with the Redis state store (`Idempotency Keys`) via Dapr to reject duplicate invoice submissions instantly.
3. **Direct State Store Writing:** Upon validation and idempotency check, writes new invoice documents directly into `mongo-invoices` with an initial status of `PENDING`. 
4. **Decoupled Workflow Handoff:** Delegated downstream routing to `orchestrator-service` (ADR 0010), which polls `mongo-invoices` asynchronously, keeping `ingestion-service` lightweight and focused purely on ingestion integrity.

## Consequences

### Pros
* **High Throughput & Resiliency:** Fast response times for incoming webhooks since `ingestion-service` only performs validation, an idempotency lookup in Redis, and a state write to MongoDB.
* **Storage-First Reliability:** Persisting directly to `mongo-invoices` before any downstream processing guarantees that no inbound invoice data is lost if downstream workers or Pub/Sub components experience failures.
* **Native Asynchrony:** Excellent performance for I/O-heavy operations (network calls to Dapr sidecar) via the Node.js event loop.
* **Unified Technology Stack:** Shares a common Node.js tech stack across the ecosystem, simplifying code reuse (validation schemas, Dapr client wrappers) and developer onboarding.

### Cons
* **CPU Bottlenecks:** Node.js is single-threaded; heavy cryptographic or parsing operations (e.g., checksum/hash generation for idempotency) must be managed to avoid blocking the event loop.
* **Sidecar & Infrastructure Overhead:** Managing Dapr sidecars and maintaining connections to both Redis (idempotency) and MongoDB (invoices) adds operational complexity in Docker/Kubernetes environments.