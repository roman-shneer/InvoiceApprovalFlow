# ADR 0007: Adoption of Dapr (Distributed Application Runtime) for Microservice Orchestration

## Status
Accepted

## Context
Our system consists of polyglot microservices (PHP Swoole, Node.js for Governance) that need to communicate, manage state, and handle pub/sub messaging. Writing custom integration code for Redis, databases, and service-to-service communication in every language creates code duplication, tight coupling to specific infrastructure vendors, and increases the time-to-market.

## Solution
We will adopt Dapr using the Sidecar pattern across our containerized infrastructure. All microservices will offload cross-cutting concerns (State Management, Pub/Sub, Service Invocation) to Dapr sidecars via standard HTTP/gRPC APIs, abstraction layers, and Dapr components.

## Consequences
### Pros:
* **Vendor Agnostic**: Code is decoupled from infrastructure; we can swap Redis for Kafka or AWS SQS in the future just by changing a YAML config, without touching the application code.
* **Polyglot Friendly**: Standardized HTTP/gRPC endpoints allow PHP Swoole and Node.js services to interact using the exact same contract.
* **Built-in Resiliency**: Dapr automatically handles retries, circuit breakers, and distributed tracing (telemetry) out of the box.

### Cons:
* **Operational Overhead**: Every microservice now requires an accompanying Dapr sidecar container, increasing resource usage and Kubernetes/Docker Compose configuration complexity.
* **Performance Network Hop**: Introduces a minor network latency overhead (sub-millisecond) because calls pass through the localhost sidecar instead of going directly to the resource.
