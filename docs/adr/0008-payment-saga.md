# ADR 0008: Architecture of the Mock Payment Service and Saga Orchestration

## Status
Accepted

## Context
The system must move corporate assets and process financial ledger updates for approved invoices. Integrating with real banking APIs or payment gateways (like Stripe or Swift) during development and testing introduces cost, dependency on external sandboxes, and non-deterministic network errors. We need a high-fidelity, predictable simulation of a banking system that still enforces strict transactional integrity across our distributed network.

## Solution
We will implement the Payment Service as a lightweight service running in the Docker container loop. Instead of synchronous HTTP calls, it will operate as a participant in a Choreographed Saga Pattern via Dapr Pub/Sub:
1. It listens to the `payment.requested` event.
2. It executes internal, deterministic state mutations (e.g., simulating a 2-second bank transfer delay using async timers).
3. It uses a random or parameterized generator to trigger successful processing or simulated network failures (to test rollback paths).
4. It publishes either `payment.confirmed` or `payment.failed` back to the Redis event stream.

## Consequences
### Pros:
* Zero cost and dependency on external payment provider infrastructure during testing.
* Allows safe end-to-end testing of the Choreographed Saga Pattern and compensating transactions (rollbacks) under predictable failure conditions.
* Asynchronous event-driven architecture prevents the entire system from blocking during simulated slow bank responses.

### Cons:
* The banking simulation is simplified and does not handle real compliance, encryption handshakes, or OAuth provider flows (will require a new ADR when replacing with a production provider).
