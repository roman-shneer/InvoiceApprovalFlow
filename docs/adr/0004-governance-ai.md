# ADR 0004: Hybrid Decision-Making Architecture for Governance Service

## Status
Accepted

## Context
The Governance service must evaluate invoices received via Dapr to either automatically approve them or route them to a human manager for manual review. Hardcoded business rules alone are insufficient for handling unstructured or edge-case invoice data, while relying entirely on human review creates a massive operational bottleneck and delays the approval flow.


## Solution
We will implement a hybrid decision-making pipeline inside the Governance service:
1. **Deterministic Rules Engine**: First, the service checks strict compliance rules (e.g., total amount limits, vendor whitelists).
2. **Local AI Model (Llama 3 via Ollama)**: If the invoice passes the rules but contains ambiguous data, it is processed by a local Llama 3 instance to analyze intent and risk.
3. **Human-in-the-Loop Escalation**: If the AI confidence score is below our threshold or detects a high-risk anomaly, the invoice is routed to a human review queue.



## Consequences
### Pros:
* Dramatically reduces human workload by automatically approving standard or low-risk invoices.
* Ensures 100% data privacy and zero data leaks by running the AI model (Llama 3) locally in our Docker infrastructure instead of using external cloud APIs (like OpenAI).
* Highly flexible architecture where business rules can be updated instantly without retraining the AI model.


### Cons:
* Local AI inference requires significant CPU/GPU resources within our Docker cluster, which could increase infrastructure costs.
* Introduces non-deterministic behavior from the AI layer, requiring strict guardrails, prompt tuning, and careful threshold management for human escalation.
