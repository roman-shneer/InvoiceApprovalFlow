# ADR 0002: Ingestion service

## Status
Accepted

## Context
The system receives a high volume of webhooks and telemetry data from external clients. This traffic is highly unpredictable and spikes during peak hours. Our current synchronous processing architecture causes timeout errors, and we risk losing data if the downstream processing services are temporarily unavailable or slow.


## Solution
We will implement the Ingestion service using PHP Swoole to enable asynchronous, non-blocking I/O operations. To decoupled the service from the state store, we will use Dapr (sidecar pattern) to publish and write incoming data asynchronously into Redis.


## Consequences
### Pros:
* High concurrency and low latency due to Swoole's coroutines and event loop.
* Reduced infrastructure complexity by using Dapr abstraction for state management.
* Fast non-blocking writes into Redis act as a high-speed buffer for incoming data.
* Standardized PHP codebase can be reused instead of rewriting the service in Go/Node.js.


### Cons:
* Increased operational complexity due to managing Dapr sidecars in the cluster.
* Swoole changes the PHP lifecycle (persistent memory), requiring careful handling of memory leaks and stateless variables.
