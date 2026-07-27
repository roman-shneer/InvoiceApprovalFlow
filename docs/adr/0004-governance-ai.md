# ADR 0004: Hybrid Decision-Making Architecture for Governance Service

## Status
Accepted

## Context
The Governance service must evaluate invoices to either automatically approve them or route them for manual review. Hardcoded business rules alone are insufficient for handling unstructured or edge-case invoice data, while relying entirely on human review creates an operational bottleneck.

Following the introduction of the `orchestrator-service` (ADR 0010), the Governance service no longer polls storage directly or manages downstream routing to payment providers. Instead, it operates as a specialized worker listening to the `invoice.pending` Dapr Pub/Sub topic for invoices in `PENDING` or stale `PROCESSING` states.

## Solution
We will implement a hybrid decision-making pipeline inside the Governance service:
1. **Event Consumption:** The service listens to `invoice.pending` events published by `orchestrator-service`.
2. **Deterministic Rules Engine:** First, the service checks strict compliance rules (e.g., total amount limits, vendor whitelists).
3. **Local AI Model (Llama 3 via Ollama):** If the invoice passes the rules but contains ambiguous data, it is processed by a local Llama 3 instance to analyze intent and risk.
4. **Human-in-the-Loop Escalation:** If the AI confidence score is below our threshold or detects a high-risk anomaly, the invoice is routed to a human review queue.
5. **State Finalization:** Once evaluated, Governance updates the invoice state in `mongo-invoices` to `AUTO_APPROVE`, `APPROVED`, or `REJECTED`. The `orchestrator-service` then automatically detects these updated states on its next cycle and dispatches them to the Payment domain (ADR 0008).

## Consequences
### Pros:
* Dramatically reduces human workload by automatically approving standard or low-risk invoices.
* Ensures 100% data privacy and zero data leaks by running the AI model (Llama 3) locally in our Docker infrastructure instead of using external cloud APIs.
* Fully decoupled from payment handling; Governance focuses purely on decision evaluation and writes terminal evaluation states back to `mongo-invoices`.
* Highly flexible architecture where business rules can be updated instantly without retraining the AI model.

### Cons:
* Local AI inference requires significant CPU/GPU resources within our Docker cluster, which could increase infrastructure costs.
* Introduces non-deterministic behavior from the AI layer, requiring strict guardrails, prompt tuning, and careful threshold management for human escalation.
