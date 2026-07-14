# ApprovalFlow — Microservice Architecture & Design Specifications

This document outlines the distributed microservice topology, transaction flows, and AI integration principles governing the ApprovalFlow expense management system.

## 1. Architectural Strategy & Autonomy Dilemma

ApprovalFlow is designed to automatically process high-volume, repetitive corporate expenses while enforcing rigid, deterministic fiscal guardrails.

### The Autonomy Posture
To protect enterprise funds from potential LLM hallucinations, prompt injections, or logic bypasses, the system separates **AI Evaluation** from **Execution Authorization** by combining a Python-native deterministic filter with an isolated MCP (Model Context Protocol) RAG Server.

*   **Deterministic Hard Stops (Client Worker):** Python-native code inside the execution worker short-circuits evaluation instantly for fatal violations (e.g., matching the `MEAL-03` alcohol-only keywords constraint) or missing mandatory parameters (`receiptPresent == false`). It applies strict rules before any network hops.
*   **The Absolute Cap:** Programmatically configured ceiling limits (such as hardware purchases exceeding $1,000 or general invoices > $2,000) trigger an immediate programmatic status mutation to `HUMAN_REVIEW` with corresponding metadata.
*   **Autonomous Range via MCP RAG:** Items requiring deeper contextual auditing are routed strictly via the Model Context Protocol (MCP) using a standard JSON-RPC Stdio channel to a server encapsulating `RagOrchestrator`. This engine leverages `qwen2.5-coder:1.5b` and vector stores (`nomic-embed-text`) to issue compliant auditing verdicts.

---

## 2. Component Design & System Boundary Topology

The system uses containerized microservices communicating via the **Dapr (Distributed Application Runtime)** sidecar pattern to abstract state storage, internal message routing, and secret protection mechanisms.

```mermaid
graph TD
    Client[Postman / Vue 3 UI] -->|HTTP Requests| Envoy[Envoy API Gateway: Port 8000]
    Envoy -->|Ingest Stream| Ingestion[Ingestion Service Node.js: Port 8001]
    
    subgraph Dapr Distributed Runtime Layer
        Ingestion <-->|Sidecar IPC| Dapr1((Ingestion Dapr Sidecar))
        AIService[AI Python Worker: Port 5001] <-->|Sidecar IPC| Dapr2((AI Service Dapr Sidecar))
        Payment <-->|Sidecar IPC| Dapr3((Payment Dapr Sidecar))
    end

    subgraph Infrastructure Components
        Dapr1 -.->|Transactional Outbox| DB[(MongoDB: mongodb-db:27017)]
        Dapr1 -.->|Idempotency Keys| Redis[(Redis Server: Port 6379)]
        Dapr1 -.->|PubSub: invoice.submitted| Dapr2
        Dapr2 -.->|PubSub: payment.requested| Dapr3
        Dapr2 -.->|Query/State API| DB
        Dapr2 -.->|Secret API Key Ref| SecretStore[(approval-secret-store: secrets.json)]
    end

    subgraph Local Isolated AI Boundary
        AIService <-->|MCP Protocol: Stdio RPC| MCPServer[MCP Server: mcp_server.py]
        MCPServer -->|RAG Vector Store| Rag[RagOrchestrator: docs/newpolicy.md]
        MCPServer -->|Local Inference HTTP| Ollama[Ollama Server: qwen2.5-coder:1.5b]
    end
```

### Microservice Directory
1.  **Ingestion Service (Node.js Express):** Exposes a high-performance input boundary. It validates JSON schemas, processes incoming headers for MD5-hashed idempotency keys to short-circuit duplicates.
2.  **AI Audit Service Worker (Python 3.12):** A continuous loop (`while True`) worker that polls `PENDING` states from MongoDB using the Dapr State Query API. It runs deterministic rule sets and delegates contextual policy validation to the MCP Boundary.
3.  **MCP RAG Server (Python FastMCP):** An isolated subprocess executing compliance evaluation. It dynamically vectorizes enterprise compliance markdown data (`newpolicy.md`) using `nomic-embed-text` and asks `qwen2.5-coder:1.5b` for deterministic, schema-validated JSON audits.
4.  **Payment Service:** Controls corporate asset movement, tracks budget allocations, and handles distributed consistency protocols.

---

## 3. End-to-End Operational Lifecycle Flows

### Scenario A: Fully Autonomous Path (Journey INV-1001)
*Condition: Standard compliant meal expense ($42.00), under the strict $75/attendee constraint, receipt present, known vendor.*

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / UI
    participant IS as Ingestion Service
    participant Dapr as Dapr State API
    participant AW as AI Python Worker
    participant MS as MCP RAG Server
    participant PS as Payment Service

    Client->>IS: POST /api/v1/expenses (Amount: \$42.00)
    IS-->>Client: 202 Accepted (Tracking ID: INV-1001)
    IS->>Dapr: Save invoice entry state as PENDING
    
    loop Every 3 Seconds
        AW->>Dapr: query_state() for PENDING invoices
    end
    Dapr-->>AW: Returns INV-1001 record
    
    Note over AW: Runs deterministic_fix()<br/>Basic constraints validation pass.
    AW->>MS: session.call_tool("audit_invoice_via_rag", invoice_data)
    Note over MS: RagOrchestrator pulls policy context<br/>Model generates verdict format='json'
    MS-->>AW: Returns JSON (AUTO_APPROVE, confidence: 1.0)
    
    AW->>Dapr: save_state() mutated invoice metadata
    AW->>Dapr: publish_event("payment.requested", json.dumps(processed_invoice))
    
    Dapr->>PS: Deliver payment event topic
    Note over PS: Finalizes ledger transfer book reserves
```

### Scenario B: Automated Hard Rejection Interception (Journey INV-1003)
*Condition: Invoice includes forbidden lines (such as alcohol-only items matching strict exclusion criteria).*

```mermaid
sequenceDiagram
    autonumber
    actor Client as Client / UI
    participant IS as Ingestion Service
    participant Dapr as Dapr State API
    participant AW as AI Python Worker

    Client->>IS: POST /api/v1/expenses (Contains line: "Alcoholic beverage")
    IS-->>Client: 202 Accepted (Tracking ID: INV-1003)
    IS->>Dapr: Save state as PENDING
    
    AW->>Dapr: query_state() pulls INV-1003
    Note over AW: Runs deterministic_fix() -> Local python keywords scan
    Note over AW: Match Found: Rule MEAL-03 violation triggered!
    Note over AW: Mutating state instantly to REJECT
    AW->>Dapr: save_state() with reason: "Alcohol-only receipts are not reimbursable"
    Note over AW: Execution sequence halted safely without calling Ollama LLM
```

---

## 4. Transaction Consistency Protocol: The Payment Saga

To guarantee structural ledger alignment without locking underlying distributed databases, the platform relies on a **Choreographed Saga Pattern** utilizing event-driven microservices.

```mermaid
graph TD
    Trigger([Autonomous Approval Issued]) --> Step1[Payment Service: Allocate Corporate Balance Reserve]
    Step1 -->|Success| Step2[Payment Service: Post Entry via Mock Bank Endpoint]
    Step2 -->|HTTP 200: Transaction Ok| Commit[Complete Saga: Update State to CONFIRMED]
    
    %% Failure Exception Pathways
    Step2 -->|Bank Rejection / bank_node_available: false| Comp1[Compensating Step: Trigger Saga Rollback]
    Comp1 --> Reset[State Store: Set REJECTED_ROLLBACK & Release Reserved Budget]
    Reset --> Emit[Publish Event: payment.failed.compensate]
```

---

## 5. Defensive Coding & Secret Store Isolation

### Distributed Component Credentials
Database connection parameters are never hardcoded inside the service specifications. The `mongo-budgets` state store configuration maps secrets securely using Dapr abstraction primitives hooked up to an underlying isolated file backing.

```yaml
apiVersion: dapr.io/v1alpha1
kind: Component
metadata:
  name: mongo-budgets
spec:
  type: state.mongodb/v1
  version: v1
  metadata:
    - name: connectionString
      secretKeyRef:
        name: mongodb-connection-string
        key: mongodb-connection-string  
    - name: databaseName
      value: "approvalflow"
  auth:
    secretStore: approval-secret-store
```
The true URI value (`mongodb://mongodb-db:27017/approvalflow`) is injected into the engine runtime boundary by Dapr securely reading from the mounted `/dapr/secrets.json` location.
