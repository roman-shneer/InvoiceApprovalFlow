# ADR 0010: Architecture of the Orchestrator Service and State-Driven Invoice Lifecycle

## Status
Accepted

## Context
The system must manage the end-to-end lifecycle of corporate invoices across multiple domains (Ingestion, Governance, and Payment). Previously, the `ingestion-service` validated idempotency via Redis, while downstream event routing was loosely distributed across individual worker services. 

As business requirements expanded to handle granular invoice states (`PENDING`, `PROCESSING`, `AUTO_APPROVE`, `APPROVED`, and `PROCESSING_PAYMENT`), direct service-to-service communication introduced tight coupling. Additionally, polling MongoDB across scaled instances created race conditions and duplicate message deliveries. We need a centralized, fault-tolerant orchestration layer that enforces sequential processing, handles stale lock recovery, and decouples governance evaluation from payment execution.

## Solution
We will introduce a dedicated `orchestrator-service` operating as a State-Driven Polling Orchestrator leveraging the Dapr Jobs API, Dapr State Query API, and Dapr Pub/Sub:
1. `ingestion-service` receives inbound invoices via Envoy API Gateway, checks Redis idempotency keys, and writes new records with status `PENDING` directly to the `mongo-invoices` state store.
2. `orchestrator-service` executes a single-instance recurring job (`mongo-event-cron`) via Dapr Scheduler to poll `mongo-invoices` item-by-item (`limit: 1`).
3. The orchestrator evaluates the current status and applies strict routing rules:
   * **Governance Routing:** Invoices with status `PENDING` or stale `PROCESSING` (>30 minutes) are published to the `invoice.pending` topic for `governance-service`.
   * **Payment Routing:** Invoices with status `AUTO_APPROVE`, `APPROVED`, or stale `PROCESSING_PAYMENT` (>30 minutes) are published to the `payment.requested` topic for `payment-service`.
4. Upon dispatch, `orchestrator-service` immediately performs an atomic state mutation in `mongo-invoices`, updating the status to `PROCESSING` (or `PROCESSING_PAYMENT`) and refreshing `processing_date = Date.now()` to lock the record from subsequent cron cycles.

## Consequences
### Pros:
* Centralizes state transition logic and routing rules into a single, maintainable boundary while keeping worker services decoupled.
* Eliminates race conditions and duplicate Pub/Sub emissions through immediate database state locking (`PROCESSING` / `PROCESSING_PAYMENT`).
* Built-in fault tolerance: if a worker pod crashes mid-execution, the 30-minute stale window (`processing_date <= Date.now() - 30m`) enables automatic recovery and retry.
* Dapr Scheduler guarantees single-pod job execution, preventing duplicate polling across horizontally scaled orchestrator replicas.

### Cons:
* State-based polling introduces a slight latency overhead bounded by the cron interval (`AI_REQUEST_DELAY`).
* Requires strict adherence to data types in Dapr State Query API (e.g., using numeric Unix timestamps instead of ISO date strings for MongoDB compatibility).