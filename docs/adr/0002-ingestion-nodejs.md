# ADR 0002: Ingestion Service Technology Stack & Event-Driven Persistence Pattern

## Status
Accepted - Supersedes the direct-persistence-only version

## Context
The system receives a high volume of webhooks and invoice ingestion requests from external clients. This traffic is highly unpredictable and spikes during peak hours. Our initial architecture risked losing data if downstream processing services were temporarily unavailable or slow.

The ingestion layer must act as a reliable entry point in a choreographed saga: validating request payloads, ensuring idempotency, persisting to the primary state store (`mongo-invoices`), and emitting a domain event to trigger the next stage.

## Solution
We will implement the Ingestion service using **Node.js** paired with Dapr sidecar integration:
1. **Asynchronous Execution:** Leverages Node.js non-blocking I/O to handle heavy request volume without blocking the event loop.
2. **Idempotency Guard:** Interacts with the Redis-backed `approval-state` store through the Dapr State API. The service derives an MD5 key from `vendor + invoiceNumber + total` and returns the existing processing state for duplicates.
3. **Storage and Event Handoff:** Upon validation and the duplicate check, writes the invoice to `mongo-invoices` with status `PENDING` and publishes `invoice.pending` through the `approval-pubsub` component.
4. **Decoupled Workflow Handoff:** Does not call downstream services directly. Governance subscribes to `invoice.pending` and continues the workflow through Dapr Pub/Sub.

## Consequences

### Pros
* **High Throughput & Resiliency:** Fast response times for incoming webhooks since `ingestion-service` only performs validation, an idempotency lookup, a state write, and a pub/sub publish.
* **Storage-First Reliability:** Persisting directly to `mongo-invoices` before publishing guarantees that no inbound invoice data is lost if Pub/Sub or downstream workers fail. Events can be replayed from the store.
* **Event-Driven Handoff:** Downstream work begins from a pub/sub event, keeping ingestion independent from Governance and Payment availability.
* **Native Asynchrony:** Excellent performance for I/O-heavy operations (network calls to Dapr sidecar) via the Node.js event loop.
* **Unified Technology Stack:** Shares a common Node.js tech stack across the ecosystem, simplifying code reuse (validation schemas, Dapr client wrappers) and developer onboarding.

### Cons
* **CPU Bottlenecks:** Node.js is single-threaded; heavy cryptographic or parsing operations (e.g., checksum/hash generation for idempotency) must be offloaded to worker threads to avoid blocking the event loop.
* **Sidecar & Infrastructure Overhead:** Managing Dapr sidecars and maintaining connections to Redis (idempotency), MongoDB (invoices), and Pub/Sub broker adds operational complexity in Docker/Kubernetes environments.
* **At-Least-Once Delivery:** Choreography requires idempotent consumers downstream - all subscribers must handle duplicate `invoice.pending` events via invoice identity checks.
