Here is the fixed ADR 0002 - with orchestrator removed and Dapr event-driven handoff:

```markdown
# ADR 0002: Ingestion Service Technology Stack & Event-Driven Persistence Pattern

## Status
Accepted - Supersedes direct-persistence + orchestrator version

## Context
The system receives a high volume of webhooks and invoice ingestion requests from external clients. This traffic is highly unpredictable and spikes during peak hours. Our initial architecture risked losing data if downstream processing services were temporarily unavailable or slow.

With the deprecation of the centralized `orchestrator-service` (ADR 0010 - disabled), the ingestion layer can no longer delegate downstream routing to an orchestrator that polls the state store. It must act as a reliable entry point in a choreographed saga: validating request payloads, ensuring idempotency, persisting to the primary state store (`mongo-invoices`), and emitting a domain event to trigger the next stage.

## Solution
We will implement the Ingestion service using **Node.js** paired with Dapr sidecar integration:
1. **Asynchronous Execution:** Leverages Node.js non-blocking I/O to handle heavy request volume without blocking the event loop.
2. **Idempotency Guard:** Interacts with the Redis state store (`Idempotency Keys`) via Dapr State Management API to reject duplicate invoice submissions instantly. Supports both client-provided `Idempotency-Key` header and server-generated hash of `vendor + invoiceNumber + total`.
3. **Storage-First + Event Emission (Outbox via Dapr):** Upon validation and idempotency check, writes new invoice documents directly into `mongo-invoices` with an initial status of `PENDING` / `RECEIVED` and publishes `invoice.received` event via Dapr Pub/Sub (backed by Kafka/Redis Streams component). Dapr Transactional Outbox guarantees atomicity of state write + event publish.
4. **Decoupled Workflow Handoff (Choreography):** Does not call downstream services directly. Downstream services (`enrichment-service`, `governance-service`) subscribe autonomously to `invoice.received` via Dapr Pub/Sub consumer groups, ensuring exactly-once processing per invoice in Kubernetes and enabling horizontal scaling.

## Consequences

### Pros
* **High Throughput & Resiliency:** Fast response times for incoming webhooks since `ingestion-service` only performs validation, an idempotency lookup, a state write, and a pub/sub publish.
* **Storage-First Reliability:** Persisting directly to `mongo-invoices` before publishing guarantees that no inbound invoice data is lost if Pub/Sub or downstream workers fail. Events can be replayed from the store.
* **No Polling / No Orchestrator Bottleneck:** Eliminates inefficient polling by orchestrator-service. The system is now fully event-driven and scales via Kubernetes replicas + Dapr consumer groups.
* **Native Asynchrony:** Excellent performance for I/O-heavy operations (network calls to Dapr sidecar) via the Node.js event loop.
* **Unified Technology Stack:** Shares a common Node.js tech stack across the ecosystem, simplifying code reuse (validation schemas, Dapr client wrappers) and developer onboarding.

### Cons
* **CPU Bottlenecks:** Node.js is single-threaded; heavy cryptographic or parsing operations (e.g., checksum/hash generation for idempotency) must be offloaded to worker threads to avoid blocking the event loop.
* **Sidecar & Infrastructure Overhead:** Managing Dapr sidecars and maintaining connections to Redis (idempotency), MongoDB (invoices), and Pub/Sub broker adds operational complexity in Docker/Kubernetes environments.
* **At-Least-Once Delivery:** Choreography requires idempotent consumers downstream - all subscribers must handle duplicate `invoice.received` events via `invoice_id` uniqueness checks.
```