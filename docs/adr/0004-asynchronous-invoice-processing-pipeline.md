# ADR 0004: Asynchronous Processing Delegation via PENDING State for Governance and AI Services

## Status
Accepted

## Context
The system must process high-volume corporate invoices against strict compliance policies without blocking the inbound API Ingestion layer or creating operational bottlenecks. Processing invoices directly inside the synchronous event handler of the Governance service creates a massive architectural coupling, increases HTTP/gRPC timeout risks, and overloads the Node.js event loop when heavy validation or contextual extraction is required.

## Solution
We will implement an asynchronous, state-driven delegation pipeline split between the Node.js Governance service and the containerized Python AI service:

1. **Governance Service (Storage-Only Ingestion Boundary):** 
   Upon receiving the `invoice.submitted` event via Dapr Pub/Sub, the Node.js Governance service acts strictly as a data-persistence gate. It transactionally writes the invoice payload into the MongoDB state store (`mongo-invoices`) with an initial status set to **`PENDING`**, and immediately terminates its execution thread successfully.

2. **AI Service Worker (Continuous Processing Backbone):**
   An isolated Python worker (`ai-service`) runs a continuous loop (`while True`) that independently polls the MongoDB database every 3 seconds using the Dapr State Store Query API, fetching invoices matching the `PENDING` criteria.

3. **Deterministic Evaluation & State Mutation:**
   The AI service executes the `deterministic_fix()` engine locally on the retrieved invoice. It performs instant keyword scanning (e.g., rule `MEAL-03` alcohol checks) and checks fiscal limits. It then mutates the status (`AUTO_APPROVE`, `REJECT`, or `HUMAN_REVIEW`), generates full `audit_metadata` blocks, and overwrites the state back to MongoDB via `client.save_state`.

## Consequences
### Pros:
* **High System Throughput:** The Governance service remains lightning-fast and non-blocking because it only writes a single record to MongoDB before finishing.
* **Resilient Architecture:** If the AI service or Ollama runtime crashes or requires a restart, incoming invoices are never lost; they safely pile up in MongoDB with a `PENDING` status until the Python worker resumes.
* **Separation of Concerns:** Node.js handles fast IO-bound event routing, while Python handles heavy data processing and deterministic rules evaluation.
* **Zero Resource Contention:** Keeps database query load completely isolated inside a controlled polling loop (`limit: 1`) to prevent Docker cluster spikes.

### Cons:
* Introduces eventual consistency; invoices are not processed instantly at the millisecond they are uploaded, but rather with a predictable 1-3 second polling latency.
* Requires careful management of concurrent polling states to ensure multiple replicas of the Python worker do not pull and process the exact same `PENDING` record simultaneously.
