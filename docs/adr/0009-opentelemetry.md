# ADR 0009: Distributed Tracing Implementation via OpenTelemetry and Zipkin

## Context
In a distributed microservice topology spanning Ingestion, Governance, and Payment nodes synchronized over asynchronous Pub/Sub channels, debugging request lifecycles and tracking execution bottlenecks across containers becomes impossible using isolated system console logs. 

If a request delays or fails mid-pipeline, tracing the failure path through point-to-point asynchronous message channels requires a centralized, unified tracking correlation layer to stitch independent telemetry scopes together.

## Decision
We adopt native Dapr OpenTelemetry (OTel) instrumentation across all containerized application sidecars, routing aggregated spans into a centralized open-source Zipkin collector infrastructure. 

The configuration enforces a 100% trace sampling profile across the entire mesh, completely removing application-layer tracing orchestration requirements from individual Node.js Express service builds.

## Consequences
*   **Positive:** Full end-to-end trace visibility across Envoy API Gateway, Ingestion pipelines, Pub/Sub event routers, and Payment settlement workers visualized on a clean Gantt-chart timeline.
*   **Positive:** Seamless context propagation across asynchronous boundaries using standardized W3C Trace Context headers managed entirely by Dapr sidecars.
*   **Positive:** Zero code polution; no heavy third-party distributed tracing packages or manual span instrumentation wrappers are injected into the Node.js application scripts.
*   **Negative:** Increased disk footprint, network overhead, and storage requirements for the cluster due to shifting the trace sampling profile to a 100% volume capture rate (`AlwaysOnSampler`).
