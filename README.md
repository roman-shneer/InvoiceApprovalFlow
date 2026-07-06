# ApprovalFlow — Architecture & Design Specification Registry

This repository contains the complete technical design, microservice topology, and Architecture Decision Records (ADRs) for the **ApprovalFlow** expense management system. 

The architecture enforces a strict decoupling of high-throughput data ingestion, hybrid AI/deterministic compliance auditing, and resilient transactional ledger management.

---

## 🗺️ Repository Structure

```text
├── docs/
│   ├── adr/                         # Architecture Decision Records (D2 Requirement)
│   │   ├── README.md                # ADR Index & Table of Contents
│   │   ├── 0001-postgres-core.md    # Core Relational Storage Selection
│   │   ├── 0002-ingestion-php.md    # High-Throughput Ingestion (PHP Swoole)
│   │   ├── 0003-redis-buffer.md     # Ephemeral In-Memory Storage Buffer
│   │   ├── 0004-governance-ai.md    # Hybrid Rules & Local LLM Framework
│   │   ├── 0005-ollama-llama3.md    # Private Offline LLM Infrastructure (Docker)
│   │   ├── 0006-management-ui.md    # Backoffice System (Node.js + Vue 3)
│   │   ├── 0007-dapr-adoption.md    # Sidecar Orchestration & Polyglot Runtime
│   │   └── 0008-payment-saga.md     # Mock Payment Framework & Saga Design
|   |   └── 0009-mongodb-store.md    # MongoDB Storage Selection
|   |   └── 0010-ingestion-nodejs.md # Ingestion Service Node.js
│   └── ARCHITECTURE.md              # System Boundary & Sequence Diagrams (D1 Requirement)
└── README.md                        # This Document
```

---

## 🚀 Key Architectural Pillars

1. **Deterministic Guardrails ($250 Cap):** The system implements a hard programmatic boundary inside the Node.js Governance service. Regardless of AI model responses, no transaction exceeding **$250.00** can be auto-approved; it is strictly escalated to a human reviewer.
2. **Data Ingestion Buffer (PHP Swoole + Redis):** To handle unpredictable traffic spikes without database connection exhaustion, the ingestion layer captures payloads asynchronously into an In-Memory buffer via Dapr State Store API.
3. **100% Data Privacy (Local Ollama / Llama 3):** To protect sensitive corporate invoice data from external processing risks, all AI inference is containerized locally using the open-source Llama 3 model inside the Docker internal network loop.
4. **Choreographed Saga Pattern:** Financial transactions handle edge-case network issues through event-driven compensating steps. If the mock bank node fails, balance reserves are programmatically rolled back.
5. **Zero-Hardcode & Security Policies:** Real production credentials, database targets, and token pairs are entirely isolated into `.env` and injected via **Dapr Secrets**. No plain-text access configuration is pushed to GitHub.

---

## 🔗 Quick Links for Reviewers

* 📂 **Core Architecture Specifications:** Go to [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) to inspect full component boundaries, interaction flows, sequence diagrams, and Saga rollback designs (built via Mermaid).
* 📑 **Architecture Decision Records:** Go to [`docs/adr/README.md`](docs/adr/README.md) to track the explicit rationale, tradeoffs, and consequences behind every critical technical selection made in this stack.
