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
│   │   ├── 0003-rate-limiting.md    # Declarative Traffic Control via Envoy Gateway
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
*   **Upstream Rate Limiting Guard:** To secure internal infrastructure nodes from concurrency spikes and traffic exhaustion, an **Envoy API Gateway** instance intercepts payload volumes directly at the network edge (`gateway/envoy.yaml`). The gateway applies a declarative local rate-limiting filter (`envoy.filters.http.local_ratelimit`) configured with a strict ceiling of **5 requests per second** on the `/api/v1/expenses` endpoint, gracefully propagating `429 Too Many Requests` states back to upstream clients during high-concurrency bursts.
*   **100% Data Privacy (Local Ollama / Llama 3):** To protect sensitive corporate invoice data from external processing risks, all AI compliance inference is containerized entirely locally using the open-source Llama 3 model inside the Docker internal network loop.
*   **Automated Test Matrix Verification:** The platform includes automated Jest suites for ingestion, governance, payment, distributed E2E journeys, and the management backoffice service. These tests validate stream processing, orchestration behavior, and edge-case resilience.
*   **Zero-Hardcode & Security Policies:** Real production credentials, database targets, and token pairs are entirely isolated into environment files and injected via Dapr Secrets. No plain-text access configuration is pushed to GitHub.
*   **Distributed Tracing & Observability (OpenTelemetry + Zipkin):** Every microservice is fully instrumented using native Dapr OpenTelemetry integration. The tracing system runs on a 100% sampling rate (AlwaysOnSampler), collecting spans from Envoy Gateway, Ingestion, Pub/Sub channels, Rules Engine, and Payment Settler to construct full end-to-end trace flows visualised inside a Zipkin dashboard.

### Runtime State Stores

The runtime relies on dedicated Mongo-backed Dapr state stores for bounded responsibilities:

* `approval-state`: idempotency keys and duplicate protection in ingestion.
* `mongo-state`: ingestion outbox events and sweeper retries.
* `mongo-invoices`: canonical invoice workflow state and audit metadata.
* `mongo-policies`: dynamic governance/autonomy policy rules.
* `mongo-fx-rates`: runtime FX conversion map used by governance and payment.
* `mongo-budgets`: department budget pools consumed by payment settlement.

🔗 Quick Links for Reviewers

📂 Core Architecture Specifications: Go to [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) to inspect full component boundaries, interaction flows, sequence diagrams, and Saga rollback designs (built via Mermaid).

📑 Architecture Decision Records: Go to [docs/adr/README.md](docs/adr/README.md) to track the explicit rationale, tradeoffs, and consequences behind every critical technical selection made in this stack.

📂 **Distributed Runtime Evidence & Proofs:** Go to [docs/JOURNEYS-EVIDENCE.md](docs/JOURNEYS-EVIDENCE.md) to inspect the immutable multi-service event logs, W3C trace tracking configurations, and final MongoDB state snapshots for all mandatory application journeys (INV-1001, INV-1003, INV-1007, INV-1012).


## 🎬 Verification & Demo Sandbox Execution

To execute and verify the complete ApprovalFlow microservice ecosystem, run the following automated harness suite locally:

```powershell
# Step 1: Clone the repository and initialize your local environment configuration
cp .env.example .env
cp dapr/secrets.json.example dapr/secrets.json
# Step 2: Bootstrap the core infrastructure mesh grid and local LLM loop
docker compose up -d --build

# Step 3: Run the automated cross-service integration and full journeys verification harness
npm run test:all

# Step 4: Run management service tests (backoffice API + resources + engines)
npm test --prefix services/management
```

Every deterministic gateway routing choice, dynamic rule-engine evaluation check, and Saga compensation event boundary can be trace-audited dynamically by accessing the local OpenTelemetry dashboard layout at: `http://localhost:9411`

### 👥 Pre-seeded Management Backoffice User Credentials & Web Access
To access the Management Backoffice Web UI Dashboard, open your browser and navigate to: **`http://localhost/`** (or port `80` inside your local container grid runtime environment).

The system comes pre-seeded with 3 explicit user roles inside MongoDB to verify Role-Based Access Control (RBAC) and dynamic resume state workflows:

1. **Finance Submitter (Employee Role)**
   * **Web Access Portal:** `http://localhost/`
   * **Login / Username:** `submitter`
   * **Password:** `submitter`
   * **Privileges:** Can submit raw expense invoices, view own submission tracking history pipelines, but has ZERO rights to approve or alter system autonomy ceiling rules.

2. **Compliance Auditor / Approver (Manager Role)**
   * **Web Access Portal:** `http://localhost/`
   * **Login / Username:** `approver`
   * **Password:** `approver`
   * **Privileges:** Full visibility into the active `HUMAN_REVIEW` escalation queues. Authorized to review AI confidence scores, view policy violations citations, and trigger manual "Approve/Reject" override actions to resume paused durable workflows.

3. **System Administrator (Admin Role)**
   * **Web Access Portal:** `http://localhost/`
   * **Login / Username:** `admin`
   * **Password:** `admin`
   * **Privileges:** Superuser rights. Authorized to manage users, policies, FX rates, budgets, and the statistics dashboard. Can hot-swap dynamic threshold bounds (`AUTONOMY-CEILING`, `AUTONOMY-CONFIDENCE`) and runtime control records directly via the backoffice without service restarts.


## ⚖️ Compliance Parameters Status (§6 Baseline Alignment)
*   **Enforced Posture:** As required by §6 of the Northwind Expense Policy, this repository enforces the conservative baseline posture (**AUTONOMY-CEILING = $250** and **AUTONOMY-CONFIDENCE = 0.80**). 
*  **Enforced Posture:**  If detected rule **MEAL-3** (alcohol) status enforced to **REJECT** instead **HUMAN_REVIEW**.
*  **Justification Record:** No unauthorized threshold tuning was performed in this release. Full risk analysis regarding latency vs. human review costs is documented under [docs/PRODUCT-DILEMMA.md](docs/PRODUCT-DILEMMA.md).

## Local Development with Kubernetes (Windows)

This project uses Kubernetes for local development and orchestration. Before proceeding, ensure you have `kubectl` installed and a local cluster running (via **Docker Desktop** or **Minikube**).

### 1. Configure Local Secrets

Production secrets are kept out of source control. For local development on `localhost`, we use mock/fake credentials:

1. Duplicate the template file to create your local configurations:
   ```powershell
   copy k8s/secrets.yaml.template k8s/secrets.yaml
   ```

### 2. Deploy to the Cluster

1. Verify that `kubectl` is successfully connected to your running Windows cluster:
   ```powershell
   kubectl cluster-info
   ```
2. Navigate to the root directory (`InvoiceApprovalFlow`) and apply all Kubernetes manifests:
   ```powershell
   kubectl apply -f ./k8s/
   ```
   *(Note: If your manifests live inside a dedicated folder, use `kubectl apply -f ./k8s/` instead).*

### 3. Verify Deployment Status

Monitor the initialization of your application pods and networking components using these commands:

```powershell
# List all running pods (containers)
kubectl get pods

# Stream pod status changes in real-time (Press Ctrl+C to exit)
kubectl get pods -w

# Check active networking services
kubectl get service

### Forward port to local machine ###
kubectl port-forward service/management-service 8080:80

### Stop/Delete all ###
kubectl delete all,configmap,secret --all --namespace=default

```


## Load & Performance Testing (Artillery)

This architecture includes an automated performance testing suite powered by **Artillery** to validate system throughput, verify token authentication boundaries, and stress-test the Ingestion Gateway under high concurrency. 

The benchmark utilizes a fast, line-by-line CSV stream cursor to pipe rows out of a 1,000,000 unique record mock data fixture without memory layout overhead.

### 📊 Performance Summary & Key Metrics

*   **Total Requests Submitted**: 4,200
*   **Successful Ingestions (HTTP 202 Accepted)**: 4,057
*   **Mean Response Latency**: 15.1 ms (p95: 34.1 ms, median: 8.9 ms)
*   **Network Socket Timeouts (`ERR_SOCKET_TIMEOUT`)**: 139 *(Observed during the peak workload phase at 15 req/sec due to local cluster network overhead).*

#### Load charts and telemetry
| Overview | Socket Timeouts |
| :---: | :---: |
| <img width="764" height="326" alt="image" src="https://github.com/user-attachments/assets/9de5a624-c35d-4c9c-99e0-784413ae388d" /> | <img width="761" height="326" alt="image" src="https://github.com/user-attachments/assets/95dda164-df38-43f9-8033-71962a277fe9" /> |
| **Response Latency** | **HTTP 202 Ingestion Throughput** |
| <img width="764" height="418" alt="image" src="https://github.com/user-attachments/assets/86cbbece-f003-4cf4-9476-f01aac7d7ce7" /> | <img width="956" height="430" alt="image" src="https://github.com/user-attachments/assets/bee03f32-095d-49e3-a9bc-381e0e923854" /> |


### 🛠️ Execution & Re-running Scenarios

Follow these steps from a Windows PowerShell or terminal console to recreate the load testing pipeline profile:

1. **Generate Mock Data Fixtures**:
   Generate a flat dataset of 1,000,000 unique, structurally valid invoices containing pre-compiled microservice payload schemes:
   ```powershell
   node ./artillery/generate-fixtures.js
   ```

2. **Execute Load Profiling Session**:
   Load authorization credentials directly out of your local secure configurations layer (`.env`) and inject them natively into the virtual user request headers stream:
   ```powershell
   # Requires dotenv-cli globally installed (npm install -g dotenv-cli) and add to .env AUTH_TOKEN of submitter
   dotenv -- artillery run --output ./artillery/report.json ./artillery/artillery-load-test.yml
   ```
