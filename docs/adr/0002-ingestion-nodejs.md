# ADR 0002: Ingestion service (Migration to Node.js)

## Status
Accepted

## Context
The system receives a high volume of webhooks and telemetry data from external clients. This traffic is highly unpredictable and spikes during peak hours. Our current synchronous processing architecture causes timeout errors, and we risk losing data if the downstream processing services are temporarily unavailable or slow.

## Solution
We will implement the Ingestion service using **Node.js** with a modern asynchronous framework to handle I/O-intensive workloads via the native event loop. To decouple the service from the infrastructure, we will use Dapr (sidecar pattern) to seamlessly manage state, handle idempotent checks, and publish incoming invoice events asynchronously into Redis.

## Consequences

### Pros
* **Native Asynchrony:** Excellent performance for I/O-heavy operations (network calls to Dapr) out-of-the-box via Node.js single-threaded event loop and async/await syntax.
* **Standard Ecosystem:** Eliminates the need for specialized PHP extensions like Swoole; runs on standard, lightweight Docker containers with rapid startup times.
* **Unified Technology Stack:** Unifies the backend codebase with our other Node.js services, allowing full code-sharing (types, validation schemas, utility functions) and simplifying developer onboarding.
* **Robust Tooling:** Access to enterprise-grade JSON validation libraries and the native Dapr Node.js SDK, reducing boilerplate validation code.
* **Reduced Memory Overheads:** Easier memory management and debugging compared to Swoole's persistent PHP runtime, minimizing risks of long-running memory leaks.

### Cons
* **CPU Bottlenecks:** Node.js is single-threaded; any heavy cryptographic operations (like excessive md5 hashing for idempotency calculation) must be carefully monitored to not block the event loop.
* **Sidecar Overhead:** Maintaining the Dapr sidecar mesh architecture adds an additional operational layer and resource usage inside the Docker cluster.
* **Dependency Noise:** Requires rigorous dependency management (npm audit) to avoid security vulnerabilities in the Node.js package ecosystem.
