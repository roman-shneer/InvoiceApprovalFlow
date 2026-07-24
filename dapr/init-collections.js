db = db.getSiblingDB('approvalflow');

print("🌱 Starting MongoDB Collections and Core Tables schema initialization...");

db.invoices.drop();

db.policies.drop();
db.policies.insertMany([
    {
        "_id": "MEAL-01",
        "_key": "MEAL-01",
        "value": { "rule_id": "MEAL-01", "category": "Meals & Entertainment", "rule_text": "Personal/team meals are reimbursable up to $75 per attendee.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "MEAL-02",
        "_key": "MEAL-02",
        "value": { "rule_id": "MEAL-02", "category": "Meals & Entertainment", "rule_text": "Client entertainment over $500 requires a business justification.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "MEAL-03",
        "_key": "MEAL-03",
        "value": { "rule_id": "MEAL-03", "category": "Meals & Entertainment", "rule_text": "Alcohol-only receipts are not reimbursable.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "TRAVEL-01",
        "_key": "TRAVEL-01",
        "value": { "rule_id": "TRAVEL-01", "category": "Travel", "rule_text": "Economy flights and standard hotels are policy-eligible.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "TRAVEL-02",
        "_key": "TRAVEL-02",
        "value": { "rule_id": "TRAVEL-02", "category": "Travel", "rule_text": "Any single travel expense over $1,500 requires manager approval.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "TRAVEL-03",
        "_key": "TRAVEL-03",
        "value": { "rule_id": "TRAVEL-03", "category": "Travel", "rule_text": "First/business-class travel always requires approval.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "SAAS-01",
        "_key": "SAAS-01",
        "value": { "rule_id": "SAAS-01", "category": "Software / SaaS", "rule_text": "Subscriptions are policy-eligible up to $200 / month.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "HW-01",
        "_key": "HW-01",
        "value": { "rule_id": "HW-01", "category": "Hardware", "rule_text": "Hardware purchases are policy-eligible up to $1,000.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "HW-02",
        "_key": "HW-02",
        "value": { "rule_id": "HW-02", "category": "Hardware", "rule_text": "Hardware over $1,000 is a Capital expense -> always human-approved.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "GLOBAL-RECEIPT",
        "_key": "GLOBAL-RECEIPT",
        "value": { "rule_id": "GLOBAL-RECEIPT", "category": "Global rules", "rule_text": "A receipt is required for any expense over $25.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "GLOBAL-VENDOR",
        "_key": "GLOBAL-VENDOR",
        "value": { "rule_id": "GLOBAL-VENDOR", "category": "Global rules", "rule_text": "A new / unknown vendor is always reviewed by a human.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "GLOBAL-FX",
        "_key": "GLOBAL-FX",
        "value": { "rule_id": "GLOBAL-FX", "category": "Global rules", "rule_text": "Foreign-currency items over $1,000 force human stop.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "GLOBAL-MATH",
        "_key": "GLOBAL-MATH",
        //"value": { "rule_id": "GLOBAL-MATH", "category": "Global rules", "rule_text": "The line items + tax must reconcile to total.", "is_active": true, "created_at": new Date() },
        "value": { "rule_id": "GLOBAL-MATH", "category": "Global rules", "rule_text": "Trigger this rule if 'discrepancy' is not 0 OR if ('calculatedLineItemsSum' + 'taxAmount') does not equal 'total'. Any mismatch between line items and total MUST be flagged under this rule code.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "GLOBAL-FRAUD",
        "_key": "GLOBAL-FRAUD",
        "value": { "rule_id": "GLOBAL-FRAUD", "category": "Global rules", "rule_text": "Fraud-pattern signals are a hard stop.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "AUTONOMY-CEILING",
        "_key": "AUTONOMY-CEILING",
        //"value": { "rule_id": "AUTONOMY-CEILING", "category": "autonomy", "rule_text": "The agent may auto-approve only when the USD amount is **≤ $250**. Above this → human, *even at confidence 1.0*. ", "is_active": true, "created_at": new Date() },
        "value": { "rule_id": "AUTONOMY-CEILING", "category": "autonomy", "rule_text": "The agent may auto-approve only when the USD amount is **<= $250**. Above this → human, *even at confidence 1.0*. ", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "AUTONOMY-CONFIDENCE",
        "_key": "AUTONOMY-CONFIDENCE",
        //"value": { "rule_id": "AUTONOMY-CONFIDENCE", "category": "autonomy", "rule_text": "The agent may auto-approve only when its `confidence` is **≥ 0.80**. Below → human.", "is_active": true, "created_at": new Date() },
        "value": { "rule_id": "AUTONOMY-CONFIDENCE", "category": "autonomy", "rule_text": "The agent may auto-approve only when its `confidence` is **<= 0.80**. Below → human.", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "AUTONOMY-HARDSTOPS",
        "_key": "AUTONOMY-HARDSTOPS",
        "value": { "rule_id": "AUTONOMY-HARDSTOPS", "category": "autonomy", "rule_text": "Regardless of amount/confidence, these **always** force a human: new/unknown vendor (`GLOBAL-VENDOR`), FX hard stop (`GLOBAL-FX`), math mismatch (`GLOBAL-MATH`), any fraud signal (`GLOBAL-FRAUD`), missing required receipt (`GLOBAL-RECEIPT`), missing required info (`MEAL-01`/`MEAL-02`).", "is_active": true, "created_at": new Date() },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    }

]);
db.policies.createIndex({ "_key": 1 }, { unique: true });

db.budgets.drop();
db.budgets.insertMany([
    {
        "_id": "marketing-2026Q2",
        "_key": "marketing-2026Q2",
        "value": { "department": "marketing-2026Q2", "amount": 1000.0 },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "engineering-2026Q2",
        "_key": "engineering-2026Q2",
        "value": { "department": "engineering-2026Q2", "amount": 50000.0 },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "sales-2026Q2",
        "_key": "sales-2026Q2",
        "value": { "department": "sales-2026Q2", "amount": 20000.0 },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
]);
db.budgets.createIndex({ "_key": 1 }, { unique: true });

db.fxRates.drop();
db.fxRates.insertMany([
    {
        "_id": "USD_2026-05-15",
        "_key": "USD_2026-05-15",
        "value": { "rate": 1.0 },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "EUR_2026-05-15",
        "_key": "EUR_2026-05-15",
        "value": { "rate": 1.08 },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },
    {
        "_id": "GBP_2026-05-15",
        "_key": "GBP_2026-05-15",
        "value": { "rate": 1.25 },
        "_etag": crypto.randomUUID(),
        "_ttl": null
    },

]);
db.fxRates.createIndex({ "_key": 1 }, { unique: true });

print("🎉 MongoDB core tables seeded successfully!");
