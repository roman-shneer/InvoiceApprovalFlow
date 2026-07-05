# Architecture Decision Records (ADRs)

This index documents the historical context, concrete decisions, and architectural tradeoffs accepted throughout the development of the ApprovalFlow platform. Every record tracks an immutable decision that the engineering team must actively defend.

## 📑 Registry Index

| ID | Decision Title | Status | Primary Component |
|:---|:---|:---|:---|
| **[ADR 0001](0001-postgres-core.md)** | Selection of PostgreSQL for Core Business Data | `Superceded` | Relational DBMS (Deprecated) |
| **[ADR 0002](0002-ingestion-php.md)** | Tech Stack for High-Throughput Ingestion Service | `Accepted` | Ingestion (PHP Swoole) |
| **[ADR 0003](0003-redis-buffer.md)** | Selection of Redis as an In-Memory Buffer | `Accepted` | Cache / Event Buffer |
| **[ADR 0004](0004-governance-ai.md)** | Hybrid Decision-Making Architecture | `Accepted` | Governance (Node.js) |
| **[ADR 0005](0005-ollama-llama3.md)** | Hosting Local LLM Infrastructure via Ollama | `Accepted` | Offline AI Subsystem |
| **[ADR 0006](0006-management-ui.md)** | Architecture for Management Backoffice Service | `Accepted` | Backoffice (Node/Vue3) |
| **[ADR 0007](0007-dapr-adoption.md)** | Adoption of Dapr for Microservice Orchestration | `Accepted` | System Mesh / Sidecar |
| **[ADR 0008](0008-payment-saga.md)** | Mock Payment Service Architecture & Saga Flow | `Accepted` | Payment Simulation |
| **[ADR 0009](0009-mongodb-invoice-store.md)** | Selection of MongoDB for Invoice Document Storage | `Accepted` | Document Store NoSQL |
| **[ADR 0010](0010-ingestion-nodejs.md)** | Implementation of Ingestion Service using Node.js | `Accepted` | Architecture Migration |

## 📐 Template Standard
Every ADR added to this directory must strictly comply with the Michael Nygard pattern specification:
* **Context:** The environmental forces, technical limits, or user criteria driving the problem.
* **Decision:** The definitive, active direction chosen by the team to resolve the context.
* **Consequences:** The immediate technical benefits (Pros) balanced against the long-term technical debts or complexities (Cons).
