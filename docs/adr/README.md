# Architecture Decision Records (ADRs)

This index documents the historical context, concrete decisions, and architectural tradeoffs accepted throughout the development of the ApprovalFlow platform. Every record tracks an immutable decision that the engineering team must actively defend.

## 📑 Registry Index

| ID | Decision Title | Status | Primary Component |
|:---|:---|:---|:---|
| **[ADR 0001](0001-mongodb-core.md)** | Core NoSQL Storage Selection (MongoDB Replica Set) | `Accepted` | Document Store NoSQL |
| **[ADR 0002](0002-ingestion-nodejs.md)** | Ingestion Service Technology Stack Realignment to Node.js | `Accepted` | Ingestion (Node.js Express) |
| **[ADR 0003](0003-rate-limiting.md)** | Declarative Traffic Control and Rate Limiting via Dapr Middleware | `Accepted` | Traffic Management / Security |
| **[ADR 0004](0004-asynchronous-invoice-processing-pipeline.md)** | Asynchronous Invoice Processing via PENDING State Delegation | `Accepted` | Governance (Node.js) & AI Service (Python) |
| **[ADR 0005](0005-ollama-llama3.md)** | Hosting Local LLM Infrastructure via Ollama | `Accepted` | Offline AI Subsystem |
| **[ADR 0006](0006-management-ui.md)** | Architecture for Management Backoffice Service | `Accepted` | Backoffice (Node/Vue3) |
| **[ADR 0007](0007-dapr-adoption.md)** | Adoption of Dapr for Microservice Orchestration | `Accepted` | System Mesh / Sidecar |
| **[ADR 0008](0008-payment-saga.md)** | Mock Payment Service Architecture & Saga Flow | `Accepted` | Payment Simulation |
| **[ADR 0009](0009-opentelemetry.md)** | Distributed Tracing Implementation via OpenTelemetry and Zipkin | `Accepted` | Observability Pipeline |

## 📐 Template Standard
Every ADR added to this directory must strictly comply with the Michael Nygard pattern specification:
* **Context:** The environmental forces, technical limits, or user criteria driving the problem.
* **Decision:** The definitive, active direction chosen by the team to resolve the context.
* **Consequences:** The immediate technical benefits (Pros) balanced against the long-term technical debts or complexities (Cons).
