This repository contains the complete technical design, microservice topology, and Architecture Decision Records (ADRs) for the ApprovalFlow expense management system.

The architecture enforces a strict decoupling of high-throughput data ingestion, hybrid AI/deterministic compliance auditing, and resilient transactional ledger management.

```text
🗺️ Repository Structure
├── dapr/
│   ├── components/                  # Dapr Component Manifests (State, Pub/Sub, Middleware)
│   └── config.yaml                  # Global Dapr Configuration (Tracing & Pipelines)
├── gateway/
│   └── envoy.yaml                   # Envoy Proxy API Gateway Config
├── services/
│   ├── ingestion/                   # Ingestion Microservice Suite (Node.js Express)
│   ├── governance/                  # Compliance & Rules Engine Agent (Node.js)
│   ├── payment/                     # Financial Settlement Node (Node.js)
│   └── management/                  # Backoffice Administration Panel (Node.js + Vue 3)
├── docs/
│   ├── adr/                         # Architecture Decision Records
│   │   ├── README.md                # ADR Index & Table of Contents
│   │   ├── 0001-mongodb-core.md     # Core NoSQL Storage Selection (MongoDB Replica Set)
│   │   ├── 0002-ingestion-nodejs.md # High-Throughput Ingestion Framework (Node.js Express)
│   │   ├── 0003-rate-limiting.md    # Declarative Traffic Control via Dapr Middleware
│   │   ├── 0004-governance-ai.md    # Hybrid Rules Engine & Local LLM Integration
│   │   ├── 0005-ollama-llama3.md    # Private Offline LLM Infrastructure (Docker Loop)
│   │   ├── 0006-management-ui.md    # Backoffice System Topology (Node.js + Vue 3)
│   │   ├── 0007-dapr-adoption.md    # Sidecar Orchestration & Distributed System Abstraction
│   │   ├── 0008-payment-saga.md     # Financial Settlement & Competing Saga Transactions
│   │   └── 0009-opentelemetry.md    # Distributed Tracing Pipeline Integration (OTel + Zipkin)
│   └── ARCHITECTURE.md              # System Boundary & Sequence Diagrams
└── README.md                        # This Document
```
🚀 Key Architectural Pillars

*   **Dynamic Autonomous Guardrails:** The system implements a programmatic boundary inside the Node.js Governance service linked to a live MongoDB policy database. Out of the box, it enforces strict defaults ($250 ceiling and 0.80 AI confidence requirement) while supporting runtime updates via runtime policy injection without system restarts.
*   **Upstream Rate Limiting Guard:** To secure internal components from traffic spikes, a declarative Dapr rate-limiting middleware intercepts payload volumes at the API Gateway layer, gracefully propagating 429 Too Many Requests exception states back to clients.
*   **100% Data Privacy (Local Ollama / Llama 3):** To protect sensitive corporate invoice data from external processing risks, all AI compliance inference is containerized entirely locally using the open-source Llama 3 model inside the Docker internal network loop.
*   **Full Production Test Matrix Verification:** The entire polyglot codebase is covered by an automated Jest testing ecosystem, ensuring full pipeline safety by simulating mock stream event cycles, macrotask loops flushing, and edge-case exceptions behaviors.
*   **Zero-Hardcode & Security Policies:** Real production credentials, database targets, and token pairs are entirely isolated into environment files and injected via Dapr Secrets. No plain-text access configuration is pushed to GitHub.
*   **Distributed Tracing & Observability (OpenTelemetry + Zipkin):** Every microservice is fully instrumented using native Dapr OpenTelemetry integration. The tracing system runs on a 100% sampling rate (AlwaysOnSampler), collecting spans from Envoy Gateway, Ingestion, Pub/Sub channels, Rules Engine, and Payment Settler to construct full end-to-end trace flows visualised inside a Zipkin dashboard.

🔗 Quick Links for Reviewers

📂 Core Architecture Specifications: Go to `docs/ARCHITECTURE.md` to inspect full component boundaries, interaction flows, sequence diagrams, and Saga rollback designs (built via Mermaid).

📑 Architecture Decision Records: Go to `docs/adr/README.md` to track the explicit rationale, tradeoffs, and consequences behind every critical technical selection made in this stack.

📂 **Distributed Runtime Evidence & Proofs:** Go to [docs/JOURNEYS-EVIDENCE.md](docs/JOURNEYS-EVIDENCE.md) to inspect the immutable multi-service event logs, W3C trace tracking configurations, and final MongoDB state snapshots for all mandatory application journeys (INV-1001, INV-1003, INV-1007, INV-1012).


## 🎬 Verification & Demo Sandbox Execution

To execute and verify the complete ApprovalFlow microservice ecosystem, run the following automated harness suite locally:

```powershell
# Step 1: Bootstrap the core infrastructure mesh grid and local LLM loop
docker compose up -d --build

# Step 2: Run the automated cross-service integration and full journeys verification harness
npm run test:all
```

Every deterministic gateway routing choice, dynamic rule-engine evaluation check, and Saga compensation event boundary can be trace-audited dynamically by accessing the local OpenTelemetry dashboard layout at: `http://localhost:9411`

📂 **Core Platform Strategy Records:** Review our definitive trade-offs analysis regarding financial compliance thresholds and AI execution postures inside the official [Product Dilemma Documentation](docs/PRODUCT-DILEMMA.md).
