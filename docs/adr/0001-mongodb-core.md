# ADR 0001: Selection of MongoDB for Invoice Document Storage

## Status
Accepted (Supercedes ADR 0001)

## Context
Invoices and expense reports in our system possess highly hierarchical, nested structures (e.g., dynamic arrays of line items, dynamic tax objects, and complex nested validation metadata from AI auditing). Storing this polymorphic and deeply nested data in a traditional relational database (PostgreSQL) requires complex schema mappings, frequent SQL JOIN operations, or heavy reliance on JSONB types, which bypasses the core structural benefits of an RDBMS.

## Solution
We will use MongoDB as the primary document store for raw and processed invoice entities. Invoices will be persisted as unified JSON-like documents, containing all line items, operational contexts, and AI compliance audit histories in a single, atomic record.

## Consequences
### Pros:
* **High Performance:** Eliminates relational JOIN overhead; entire invoices including all line items are fetched or updated in a single operation.
* **Polymorphic Schema:** Easily accommodates dynamic fields (e.g., specific currency conversion notes, dynamic compliance violations) without requiring SQL schema migrations.
* **Developer Velocity:** Direct alignment between the Node.js application objects and the database document representation.

### Cons:
* **Operational Complexity:** Ensuring continuous strict distributed consensus and transactional integrity across components requires deploying MongoDB in a Replica Set configuration.
* **Reporting Limitations:** Complex analytical queries and calculations (e.g., aggregate invoice statistics for the Management Service) are harder to optimize compared to mature relational SQL engines.
