# ApprovalFlow — Microservice Architecture & Design Specifications

This document outlines the distributed microservice topology, transaction flows, and AI integration principles governing the ApprovalFlow expense management system.

## 1. Architectural Strategy & Autonomy Dilemma

ApprovalFlow is designed to automatically process high-volume, repetitive corporate expenses while enforcing rigid, deterministic fiscal guardrails.

### The Autonomy Posture
To protect enterprise funds from potential LLM hallucinations, prompt injections, or logic bypasses, the system separates **AI Evaluation** from **Execution Authorization**.

*   **The Absolute Cap:** Programmatically configured and enforced via runtime MongoDB policy injection at **$250.00**. No invoice exceeding $250.00 will ever be auto-approved, regardless of the AI Agent's evaluation score or confidence level; it is strictly escalated to human review.
*   **Deterministic Hard Stops:** Specific validation rules (such as missing receipts or unknown fraudulent vendors) trigger an immediate programmatic override status (`GLOBAL-RECEIPT` or `GLOBAL-FX`), short-circuiting the AI path entirely.
*   **Autonomous Range:** Items under **$250.00** satisfying the minimum baseline confidence configuration threshold (`AUTONOMY-CONFIDENCE = 0.80`) are autonomously verified against corporate policy using an AI processing engine.

---

## 2. Component Design & System Boundary Topology

The system uses containerized microservices communicating via the **Dapr (Distributed Application Runtime)** sidecar pattern to abstract state storage, internal message routing, and secret protection mechanisms. Distributed tracing spans are natively collected by Dapr and exported to an OpenTelemetry-compliant Zipkin backend.

```mermaid
graph TD
    Client[Postman / Vue 3 UI] -->|HTTP Requests| Envoy[Envoy API Gateway: Port 8000]
    Envoy -->|Ingest Stream| Ingestion[Ingestion Service Node.js: Port 8001]
    
    subgraph Dapr Architectural Layer
        Ingestion <-->|Sidecar IPC| Dapr1((Ingestion Dapr Sidecar))
        Orchestrator <-->|Sidecar IPC| Dapr5((Orchestrator Dapr Sidecar))
        Governance <-->|Sidecar IPC| Dapr2((Governance Dapr Sidecar))
        Payment <-->|Sidecar IPC| Dapr3((Payment Dapr Sidecar))
        Management <-->|Sidecar IPC| Dapr4((Management Dapr Sidecar))
    end

    subgraph Infrastructure Components
        Dapr1 -.->|Idempotency Keys| Redis[(Redis Server: Port 6379)]
        Dapr1 -.->|Write PENDING State| DB[(MongoDB Replica Set: Port 27017)]
        
        Dapr5 -.->|Poll & Update State| DB
        Dapr5 -.->|PubSub: invoice.pending| Dapr2
        Dapr5 -.->|PubSub: payment.requested| Dapr3
        
        Dapr2 -.->|State: mongo-invoices| DB
        Dapr3 -.->|State: mongo-invoices| DB
    end

    subgraph Local Secure AI Boundary
        Dapr2 -->|Local HTTP Inference| Ollama[Ollama Service: Llama 3]
    end

    subgraph Observability Pipeline
        Dapr1 -.->|OTel Spans Export| Zipkin[Zipkin Dashboard: Port 9411]
        Dapr5 -.->|OTel Spans Export| Zipkin
        Dapr2 -.->|OTel Spans Export| Zipkin
        Dapr3 -.->|OTel Spans Export| Zipkin
    end
```

### Microservice Directory
1.  **Ingestion Service (Node.js Express):** Exposes a high-performance input boundary. It validates JSON schemas, processes incoming headers for MD5-hashed idempotency keys in Redis to short-circuit duplicates, and writes new invoices directly with status PENDING into mongo-invoices.
2.  **Orchestrator Service (Node.js)** Centralized state-driven polling orchestrator (0010-orchestrator.md). Uses Dapr Scheduler (mongo-event-cron) to poll mongo-invoices item-by-item, locks records in PROCESSING state, and dispatches tasks to governance-service (invoice.pending) or payment-service (payment.requested).
2.  **Governance & AI Engine Agent (Node.js):** Listens to invoice.pending events. Evaluates deterministic hard stop constraints (currency checks, receipt requirements) and coordinates local asynchronous LLM inference cycles via Ollama. Updates evaluation results (AUTO_APPROVE, APPROVED, REJECTED) back into mongo-invoices.
3.  **Payment Service:** Controls corporate asset movement. Listens to payment.requested events, tracks budget allocations, simulates edge-case connectivity status triggers with mock banking endpoints, and publishes terminal events (payment.confirmed / payment.failed).
4.  **Management Service (Node.js + Vue 3):** Administrative backoffice backplane used to re-configure runtime autonomy ceiling properties dynamically inside MongoDB.

---

## 3. End-to-End Operational Lifecycle Flows

### Scenario A: Fully Autonomous Path (Journey INV-1001)
*Condition: Standard compliance invoice, total value under threshold bounds ($45.00), strict adherence to all valid compliance lines.*

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / Postman
    participant Envoy as Envoy Gateway
    participant IS as Ingestion Service
    participant DB as MongoDB State Store
    participant OS as Orchestrator Service
    participant GS as Governance Engine
    participant PS as Payment Service
    participant ZK as Zipkin OTel

    Client->>Envoy: POST /api/v1/expenses (Trace Context Attached)
    Envoy->>IS: Forward to Ingestion (Port 8001)
    Note over IS: Verifies Idempotency-Key via Redis<br/>Stitches W3C Trace Context
    IS->>DB: Write invoice directly (Status: PENDING)
    IS-->>Client: 202 Accepted (Tracking ID: INV-1001)
    IS->>ZK: Export Ingestion Span

    Note over OS: Dapr Cron Job Triggers (mongo-event-cron)<br/>Queries mongo-invoices (limit: 1)
    OS->>DB: Mutate status to PROCESSING
    OS->>GS: Dapr Pub/Sub: invoice.pending
    OS->>ZK: Export Orchestrator Span

    Note over GS: Evaluates applyOverride() -> Auto-Approve
    GS->>DB: Persist Audited Status: AUTO_APPROVE

    Note over OS: Next Cron Cycle reads AUTO_APPROVE
    OS->>DB: Mutate status to PROCESSING_PAYMENT
    OS->>PS: Dapr Pub/Sub: payment.requested

    Note over PS: Processes budget reserve<br/>Calls mock banking node -> Success
    PS->>DB: Persist Ledger Status: PAID
    PS->>OS: Dapr Pub/Sub: payment.confirmed
    PS->>ZK: Export Payment Span
```

### Scenario B: Human-in-the-Loop Interception (Journey INV-1007)
*Condition: High-value invoice ($1250.00), total cost breaches the automated dollar threshold rule ($250.00).*

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / Postman
    participant IS as Ingestion Service
    participant DB as MongoDB State Store
    participant OS as Orchestrator Service
    participant GS as Governance Engine

    Client->>IS: POST /api/v1/expenses (Amount: \$1250.00)
    IS->>DB: Save invoice (Status: PENDING)
    IS-->>Client: 202 Accepted (Tracking ID: INV-1007)
    
    Note over OS: Cron picks up PENDING invoice
    OS->>DB: Lock status to PROCESSING
    OS->>GS: Dapr Pub/Sub: invoice.pending
    
    Note over GS: applyOverride Triggered:<br/>\$1250 exceeds AUTONOMY-CEILING (\$250).
    GS->>DB: Save to mongo-invoices (Status: HUMAN_REVIEW, triggered_rules: ["AUTONOMY-CEILING"])
    Note over GS: Execution sequence paused for manual backoffice review
```

---

## 4. Transaction Consistency Protocol: The Payment Saga

To guarantee structural ledger alignment without locking underlying distributed databases, the platform relies on an Orchestrated Saga Pattern utilizing event-driven microservices (0008-payment-saga.md).

```mermaid
graph TD
    Trigger([Orchestrator Dispatches payment.requested]) --> Step1[Payment Service: Allocate Corporate Balance Reserve]
    Step1 -->|Success| Step2[Payment Service: Post Entry via Mock Bank Endpoint]
    Step2 -->|HTTP 200: Transaction Ok| Commit[Complete Saga: Update State to PAID & Publish payment.confirmed]
    
    %% Failure Exception Pathways
    Step2 -->|Bank Rejection / bank_node_available: false| Comp1[Compensating Step: Trigger Saga Rollback]
    Comp1 --> Reset[State Store: Set REJECTED_ROLLBACK & Release Reserved Budget]
    Reset --> Emit[Publish Event: payment.failed]
```

### Rollback Process Mechanics (Journey INV-1012)
1.  **Initial Reserve:** `Payment Service` locks internal funds matching the invoice value to prevent over-allocation.
2.  **External Link Failure:** The simulated banking node throws a network connection timeout or a simulated rejection (`bank_node_available: false`).
3.  **Trigger Compensation:** The service catches the exception, updates the transaction state model to `REJECTED_ROLLBACK`, releases the locked budget reserve, and publishes `payment.failed`.
4.  **Final Sync:** `Orchestrator Service` and `Management Service` catch the failure event to notify audit logs and administration backoffice panels.

---

## 5. Defensive Coding & Idempotency Safeguards

### Inbound De-duplication (Journey INV-1003)
Every submission payload is hashed using an MD5 encryption sequence based on vendor, `invoiceNumber`, and `total` parameters. If a subsequent request matches an active concurrency transaction key inside Redis, the Ingestion layer short-circuits execution completely, returning the original `200 OK PROCESSING` schema state without generating duplicate database records or triggering downstream orchestrator cycles.
