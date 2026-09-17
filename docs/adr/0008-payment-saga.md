# ADR 0008: Architecture of the Mock Payment Service and Choreographed Saga Flow

## Status
Accepted - Supersedes the earlier centralized-routing version

## Context
The system must move corporate assets and process financial ledger updates for approved invoices. Integrating with real banking APIs or payment gateways (like Stripe or Swift) during development and testing introduces cost, dependency on external sandboxes, and non-deterministic network errors. We need a high-fidelity, predictable simulation of a banking system that still enforces strict transactional integrity across our distributed network.

The system follows a choreographed saga via the Dapr Pub/Sub backbone. Payment is triggered directly by the `invoice.payment` event after Governance evaluates an invoice as payment-eligible.

## Solution
We will implement the Payment Service as a lightweight service running in the Docker container loop. It will operate as an autonomous participant in a Choreographed Saga Pattern via Dapr Pub/Sub:
1. It listens directly to the `invoice.payment` event published by Governance.
2. It executes internal, deterministic state mutations (e.g., simulating a 2-second bank transfer delay using async timers) and updates its own local state idempotently via `invoice_id`.
3. It uses a random or parameterized generator to trigger successful processing or simulated network failures (to test rollback/compensation paths).
4. It publishes terminal events `payment.confirmed` or `payment.failed` back to the Dapr event backbone (`pubsub`). Downstream services (invoice state store, ledger) subscribe to these events to finalize the status to `PAID` or `FAILED` without a central coordinator.

Payment processing is idempotent and persists its ledger and budget changes through Dapr state. Stale Governance work is handled separately by the Governance leader-election recovery loop.

## Consequences
### Pros:
* Zero cost and dependency on external payment provider infrastructure during testing.
* No single workflow coordinator bottleneck; fully decentralized and scalable in Kubernetes via Dapr consumer groups.
* Aligns with Dapr best practices for choreography: loose coupling via pub/sub, idempotent consumers, and outbox pattern.
* Asynchronous event-driven architecture prevents worker pipelines from blocking during simulated slow bank responses.

### Cons:
* Loss of centralized visibility of saga state - tracing requires distributed tracing through Dapr and Zipkin.
* Compensation logic for failures is distributed across services rather than managed in one place (requires careful handling of `payment.failed` events).
* The banking simulation is simplified and does not handle real compliance, encryption handshakes, or OAuth provider flows (will require a new ADR when replacing with a production provider).