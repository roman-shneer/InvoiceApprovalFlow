# ADR 0004: Hybrid Decision-Making Architecture for Governance Service

## Status
Accepted - Supersedes the earlier centralized-routing version

## Context
The Governance service must evaluate invoices to either automatically approve them or route them for manual review. Hardcoded business rules alone are insufficient for handling unstructured or edge-case invoice data, while relying entirely on human review creates an operational bottleneck.

The Governance service operates as an autonomous participant in the choreographed flow, triggered directly by `invoice.pending` domain events via Dapr Pub/Sub.

## Solution
We will implement a hybrid decision-making pipeline inside the Governance service:
1. **Event Consumption:** The service subscribes directly to `invoice.pending` events published by the Ingestion service via Dapr Pub/Sub. It uses Dapr consumer groups to distribute event delivery across replicas.
2. **Deterministic Rules Engine (First Pass):** First, the service evaluates 90% of rules as pure code for determinism and performance (e.g., `total > 250`, `total_items_sum != total`, `GLOBAL-RECEIPT`, `GLOBAL-VENDOR`). This avoids LLM hallucination for math checks.
3. **Local AI Model (Qwen 2.5 / Llama 3 via Ollama) (Second Pass):** If the invoice passes code-rules but contains ambiguous data, it is processed by a local model for fuzzy checks only: `is_alcohol_only`, `is_fraud_pattern`, `client_name_present`. The model is invoked via `format: json` with an `evaluations` object to prevent contradictory instructions.
4. **Human-in-the-Loop Escalation:** If code-rules fail or AI confidence score is below threshold (< 0.8) or detects a high-risk anomaly, the invoice is routed to a human review queue by publishing `invoice.needs_review`.
5. **State Finalization via Events:** Once evaluated, Governance updates the invoice state in `mongo-invoices` and publishes `invoice.payment` for payment-eligible decisions. Payment subscribes directly to that event to continue the saga.

6. **Leader-Based Recovery:** Replicas use the shared `leader:reclaimer` record in `approval-state` with an expiration timestamp and compare-and-set writes. The elected temporary leader alone reclaims stale processing records; normal event consumption remains distributed.

Idempotency is enforced via `invoice_id` + Dapr State Store and a unique index on `invoices` to handle at-least-once delivery in Kubernetes.

## Consequences
### Pros:
* Dramatically reduces human workload by automatically approving standard or low-risk invoices.
* Ensures 100% data privacy and zero data leaks by running the AI model locally in our Docker infrastructure instead of using external cloud APIs.
* Fully decoupled and resilient: no central workflow coordinator; services scale independently via Dapr consumer groups, with leader election limited to recovery coordination.
* Deterministic-first design: math/compliance rules are code-based (100% accurate), LLM is used only for unstructured intent, reducing GPU cost and non-determinism.

### Cons:
* Local AI inference requires significant CPU/GPU resources within our Docker cluster, which could increase infrastructure costs.
* Introduces non-deterministic behavior from the AI layer, requiring strict guardrails, prompt tuning, and threshold management for human escalation.
* Loss of central saga visibility - requires distributed tracing (Dapr + Jaeger/Zipkin) to follow invoice lifecycle.