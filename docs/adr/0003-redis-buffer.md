# ADR 0003: Selection of Redis as an In-Memory Buffer for Data Ingestion

## Status
Accepted

## Context
The Ingestion service receives a massive volume of unpredictable webhooks and telemetry traffic. Writing this incoming data directly to our primary relational database (PostgreSQL) causes connection bottlenecks and high disk I/O latency, risking service degradation. We need a high-throughput, low-latency temporary storage layer to act as a buffer.

## Solution
We will use Redis as an In-Memory data store to capture and serialize incoming payloads instantly. The Ingestion service will write to Redis via the Dapr state management building block, allowing background workers to safely process and flush data to the main DB at a controlled pace.

## Consequences
### Pros:
* Sub-millisecond write latency due to Redis operating entirely in memory.
* Isolates the primary database (PostgreSQL) from traffic spikes and high-frequency writes.
* Native integration with Dapr's State Management API simplifies the codebase.
* Data structures (like Hashes or Lists) match the ephemeral nature of ingestion payloads.

### Cons:
* Risk of data loss if the Redis instance crashes before data is persisted to the disk or processed by workers (mitigated by configuring RDB/AOF persistence).
* Additional infrastructure component to monitor, scale, and maintain in the cluster.
