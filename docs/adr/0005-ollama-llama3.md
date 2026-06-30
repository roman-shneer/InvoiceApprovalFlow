# ADR 0005: Hosting Local LLM Infrastructure via Ollama

## Status
Accepted

## Context
The Governance service requires natural language processing capabilities to analyze invoices and assist in automated decision-making. Using external cloud AI APIs (like OpenAI) is unacceptable due to strict compliance, data privacy regulations, and the risk of leaking sensitive financial and user data. We need a fully self-hosted, scalable solution to run open-source models inside our infrastructure.

## Solution
We will deploy Ollama as a dedicated containerized service (`ollama-service`) within our Docker network. It will host the Llama 3 model locally, exposing a standard HTTP API for the Governance service to perform offline inference.

## Consequences
### Pros:
* 100% data privacy and compliance; no financial or invoice data leaves our secure network perimeter.
* Zero variable API transaction costs; we pay only for the underlying infrastructure, not per token.
* Predictable latency and independence from external network outages or API rate limits.
* Simple model management and orchestration via standard Docker containers.

### Cons:
* Significant hardware resource consumption (high RAM/VRAM and CPU/GPU usage) on our self-hosted servers.
* The team is responsible for managing model lifecycle, container updates, and scaling the inference hardware manually.
