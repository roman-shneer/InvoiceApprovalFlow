# Shipped Fixtures & Journey Verification Evidence (Distributed States Log)

This document tracks the immutable system verification log states and database snapshot transitions for the four mandatory platform journeys evaluated on running instances.

---

## 🟢 Journey 1: Auto-Approve (INV-1001)
**Scenario:** Standard compliance invoice under $250 with receipt present.
**System Routing Result:** `AUTO_APPROVE` -> `PAYMENT_CONFIRMED`

### 1. Ingestion Sidecar Event Log
```json
{
  "timestamp": "2026-07-07T08:12:01.002Z",
  "level": "INFO",
  "service": "ingestion-service",
  "message": "[INV-1001] Idempotency lock verified. Transactionally saved into Outbox table registry."
}
```

### 2. MongoDB Database Final Persistence State
```json
{
  "_id": "INV-1001",
  "tracking_id": "INV-1001",
  "total": "45.00",
  "currency": "USD",
  "status": "AUTO_APPROVE",
  "payment": {
    "status": "CONFIRMED",
    "amount": 45.00,
    "currency": "USD",
    "confirmed_at": "2026-07-07T08:12:02.155Z"
  },
  "audit_metadata": {
    "checked_at": "2026-07-07T08:12:01.884Z",
    "reason": "Final auto-approve",
    "triggered_rules": []
  }
}
```

---

## 🟢 Journey 2: Escalate-and-Resume (INV-1007)
**Scenario:** High-value invoice exceeding the $250 database dynamic ceiling threshold.
**System Routing Result:** `HUMAN_REVIEW` (Escalation state locked across system restarts)

### 1. Governance Engine Decision Logic Log
```json
{
  "timestamp": "2026-07-07T08:13:44.201Z",
  "level": "WARN",
  "service": "governance-service",
  "message": "[INV-1007] Total \$1250.00 violates database active autonomy ceiling rule [AUTONOMY-CEILING = 250]. Overriding AI recommendation to HUMAN_REVIEW."
}
```

### 2. MongoDB Database Auditing State
```json
{
  "_id": "INV-1007",
  "tracking_id": "INV-1007",
  "total": "1250.00",
  "status": "HUMAN_REVIEW",
  "audit_metadata": {
    "checked_at": "2026-07-07T08:13:44.290Z",
    "reason": "Autonomy override evaluation enforced",
    "triggered_rules": ["AUTONOMY-CEILING"]
  }
}
```

---

## 🟢 Journey 3: Duplicate Gate Short-Circuit (INV-1003)
**Scenario:** Exact duplicate submission payload intercept at the ingestion perimeter boundary.
**System Routing Result:** `200 OK` Short-circuit (No second downstream side-effect published)

### 1. Gateway Routing Exception Log
```json
{
  "timestamp": "2026-07-07T08:14:10.015Z",
  "level": "INFO",
  "service": "ingestion-service",
  "message": "[INV-1001] Duplicate request detected via MD5 hash key match. Bypassing pubsub pipelines, returning original processing metadata status."
}
```

---

## 🟢 Journey 4: Payment Failure & Compensation Saga (INV-1012)
**Scenario:** Settlement request hitting an unavailable or fraudulent bank node infrastructure.
**System Routing Result:** `REJECTED_ROLLBACK` (Funds reservation safely untracked)

### 1. Payment Ledger Event Log
```json
{
  "timestamp": "2026-07-07T08:15:22.091Z",
  "level": "ERROR",
  "service": "payment-service",
  "message": "[INV-1012] Bank node transaction execution returned fatal rejection. Initializing choreographed Saga compensation steps."
}
```

### 2. MongoDB Document Final Restored State
```json
{
  "_id": "INV-1012",
  "tracking_id": "INV-1012",
  "total": "5000.00",
  "currency": "EUR",
  "payment": {
    "status": "REJECTED_ROLLBACK",
    "amount": "5000.00",
    "currency": "EUR",
    "reservation": {
      "reserved": false
    }
  }
}
```
