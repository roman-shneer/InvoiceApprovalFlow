# ADR 0008: Architecture of the Mock Payment Service and Choreographed Saga Flow

## Status
Accepted - Supersedes orchestrated version

## Context
The system must move corporate assets and process financial ledger updates for approved invoices. Integrating with real banking APIs or payment gateways (like Stripe or Swift) during development and testing introduces cost, dependency on external sandboxes, and non-deterministic network errors. We need a high-fidelity, predictable simulation of a banking system that still enforces strict transactional integrity across our distributed network.

With the deprecation of the centralized `orchestrator-service` (ADR 0010 - disabled), payment dispatches are no longer routed by an orchestrator. The system now follows a choreographed saga via Dapr Pub/Sub backbone. Payment is triggered directly by domain events when invoices reach `AUTO_APPROVE` or `APPROVED` states after the policy-engine.

## Solution
We will implement the Payment Service as a lightweight service running in the Docker container loop. Instead of synchronous HTTP calls or orchestrator-routed commands, it will operate as an autonomous participant in a Choreographed Saga Pattern via Dapr Pub/Sub:
1. It listens directly to domain events `invoice.approved` / `invoice.auto_approved` published by `decision-router-service` (not by an orchestrator).
2. It executes internal, deterministic state mutations (e.g., simulating a 2-second bank transfer delay using async timers) and updates its own local state idempotently via `invoice_id`.
3. It uses a random or parameterized generator to trigger successful processing or simulated network failures (to test rollback/compensation paths).
4. It publishes terminal events `payment.confirmed` or `payment.failed` back to the Dapr event backbone (`pubsub`). Downstream services (invoice state store, ledger) subscribe to these events to finalize the status to `PAID` or `FAILED` without a central coordinator.

Payment recovery for stale `PROCESSING_PAYMENT` states is handled via scheduled Dapr Cron binding / TTL check inside the payment service itself, not by an external orchestrator sweep.

## Consequences
### Pros:
* Zero cost and dependency on external payment provider infrastructure during testing.
* No single point of failure / bottleneck from a central orchestrator; fully decentralized and scalable in Kubernetes via Dapr consumer groups.
* Aligns with Dapr best practices for choreography: loose coupling via pub/sub, idempotent consumers, and outbox pattern.
* Asynchronous event-driven architecture prevents worker pipelines from blocking during simulated slow bank responses.

### Cons:
* Loss of centralized visibility of saga state - tracing now requires distributed tracing (Dapr + Zipkin/Jaeger) instead of orchestrator logs.
* Compensation logic for failures is distributed across services rather than managed in one place (requires careful handling of `payment.failed` events).
* The banking simulation is simplified and does not handle real compliance, encryption handshakes, or OAuth provider flows (will require a new ADR when replacing with a production provider).