Here is the updated **ADR 0008** reflecting the addition of the Orchestrator Service (`orchestrator-service`) as the driver of the payment saga flow.

Key changes made to align with ADR 0010:

* Updated **Context** to mention that payment requests are now routed by the `orchestrator-service` when invoices reach `AUTO_APPROVE`, `APPROVED`, or stale `PROCESSING_PAYMENT` states.
* Updated **Solution** point 1 and 4 to specify that it processes events routed to `payment.requested` by the orchestrator and sends terminal events (`payment.confirmed` / `payment.failed`) back to the event backbone so the orchestrator (or state store) can finalize the status (e.g., `PAID` or `FAILED`).

---

```markdown
# ADR 0008: Architecture of the Mock Payment Service and Orchestrated Saga Flow

## Status
Accepted

## Context
The system must move corporate assets and process financial ledger updates for approved invoices. Integrating with real banking APIs or payment gateways (like Stripe or Swift) during development and testing introduces cost, dependency on external sandboxes, and non-deterministic network errors. We need a high-fidelity, predictable simulation of a banking system that still enforces strict transactional integrity across our distributed network.

With the introduction of the centralized `orchestrator-service` (ADR 0010), payment dispatches are no longer triggered directly by worker services. Instead, the orchestrator identifies invoices in `AUTO_APPROVE`, `APPROVED`, or stale `PROCESSING_PAYMENT` states and routes them to the payment domain via Dapr Pub/Sub.

## Solution
We will implement the Payment Service as a lightweight service running in the Docker container loop. Instead of synchronous HTTP calls, it will operate as an asynchronous participant in a Saga Pattern via Dapr Pub/Sub:
1. It listens to the `payment.requested` event published by `orchestrator-service`.
2. It executes internal, deterministic state mutations (e.g., simulating a 2-second bank transfer delay using async timers).
3. It uses a random or parameterized generator to trigger successful processing or simulated network failures (to test rollback/compensation paths).
4. It publishes either `payment.confirmed` or `payment.failed` back to the event stream so the orchestrator can finalize the invoice state in `mongo-invoices` (e.g., transition to `PAID` or handle failure compensation).

## Consequences
### Pros:
* Zero cost and dependency on external payment provider infrastructure during testing.
* Fully decoupled from governance logic; reads payment events cleanly emitted by `orchestrator-service`.
* Allows safe end-to-end testing of the Saga Pattern and compensating transactions (rollbacks) under predictable failure conditions.
* Asynchronous event-driven architecture prevents the orchestrator and worker pipelines from blocking during simulated slow bank responses.

### Cons:
* The banking simulation is simplified and does not handle real compliance, encryption handshakes, or OAuth provider flows (will require a new ADR when replacing with a production provider).

```