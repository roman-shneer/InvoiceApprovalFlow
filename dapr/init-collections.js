db = db.getSiblingDB('approvalflow');

print("🌱 Starting MongoDB Collections and Core Tables schema initialization...");


db.users.drop();
db.users.insertMany([
    {
        "username": "admin",
        "password_hash": "$2b$10$DVOwbaMyodo14gLzlhOeKO1wg3EjZhKfm6.IXyodVlziUZ8kZ74AK",
        "role": "admin",
        "full_name": "John Doe (Compliance Head)"
    },
    {
        "username": "submitter",
        "password_hash": "$2b$10$DVOwbaMyodo14gLzlhOeKOTMygkZWyUvjT/r4/K0PMEpySV3iGpUW",
        "role": "submitter",
        "full_name": "Alice Smith (FinOps Auditor)"
    },
    {
        "username": "approver",
        "password_hash": "$2b$10$DVOwbaMyodo14gLzlhOeKOiq9dNw6Uht65K4UJMB4/xmERM6re67m",
        "role": "approver",
        "full_name": "Bob Johnson (Department Manager)"
    }
]);
db.users.createIndex({ "username": 1 }, { unique: true });


db.invoices.drop();
db.invoices.insertMany([
    {
        "id": "INV-551234",
        "correlation_id": "corr_init1",
        "vendor": "DataDog",
        "invoiceNumber": "DD-1002",
        "total": 150.00,
        "category": "Software / SaaS",
        "ai_metadata": { "recommendation": "AUTO_APPROVE", "confidence": 0.98, "triggered_rules": [] },
        "status": "AUTO_APPROVED",
        "department_id": "unassigned",
        "rejection_reason": null,
        "submitted_at": new Date(Date.now() - 2 * 60 * 60 * 1000)
    },
    {
        "id": "INV-551235",
        "correlation_id": "corr_init2",
        "vendor": "Unknown Vendor Corp",
        "invoiceNumber": "UNK-99",
        "total": 420.00,
        "category": "Hardware",
        "ai_metadata": { "recommendation": "HUMAN_REVIEW", "confidence": 0.50, "triggered_rules": [] },
        "status": "HUMAN_REVIEW",
        "department_id": "unassigned",
        "rejection_reason": null,
        "submitted_at": new Date(Date.now() - 1 * 60 * 60 * 1000)
    },
    {
        "id": "INV-551236",
        "correlation_id": "corr_init3",
        "vendor": "SteakHouse IT",
        "invoiceNumber": "SH-881",
        "total": 1250.00,
        "category": "Meals & Entertainment",
        "ai_metadata": { "recommendation": "REJECT", "confidence": 0.90, "triggered_rules": [] },
        "status": "REJECTED",
        "department_id": "unassigned",
        "rejection_reason": "Automated fraud patterns detected or budget overrun.",
        "submitted_at": new Date(Date.now() - 30 * 60 * 1000)
    }
]);
db.invoices.createIndex({ "id": 1 }, { unique: true });


db.policies.drop();
db.policies.insertMany([
    { "rule_id": "MEAL-01", "category": "Meals & Entertainment", "rule_text": "Personal/team meals are reimbursable up to $75 per attendee.", "is_active": true, "created_at": new Date() },
    { "rule_id": "MEAL-02", "category": "Meals & Entertainment", "rule_text": "Client entertainment over $500 requires a business justification.", "is_active": true, "created_at": new Date() },
    { "rule_id": "MEAL-03", "category": "Meals & Entertainment", "rule_text": "Alcohol-only receipts are not reimbursable.", "is_active": true, "created_at": new Date() },
    { "rule_id": "TRAVEL-01", "category": "Travel", "rule_text": "Economy flights and standard hotels are policy-eligible.", "is_active": true, "created_at": new Date() },
    { "rule_id": "TRAVEL-02", "category": "Travel", "rule_text": "Any single travel expense over $1,500 requires manager approval.", "is_active": true, "created_at": new Date() },
    { "rule_id": "TRAVEL-03", "category": "Travel", "rule_text": "First/business-class travel always requires approval.", "is_active": true, "created_at": new Date() },
    { "rule_id": "SAAS-01", "category": "Software / SaaS", "rule_text": "Subscriptions are policy-eligible up to $200 / month.", "is_active": true, "created_at": new Date() },
    { "rule_id": "HW-01", "category": "Hardware", "rule_text": "Hardware purchases are policy-eligible up to $1,000.", "is_active": true, "created_at": new Date() },
    { "rule_id": "HW-02", "category": "Hardware", "rule_text": "Hardware over $1,000 is a Capital expense -> always human-approved.", "is_active": true, "created_at": new Date() },
    { "rule_id": "GLOBAL-RECEIPT", "category": "Global rules", "rule_text": "A receipt is required for any expense over $25.", "is_active": true, "created_at": new Date() },
    { "rule_id": "GLOBAL-VENDOR", "category": "Global rules", "rule_text": "A new / unknown vendor is always reviewed by a human.", "is_active": true, "created_at": new Date() },
    { "rule_id": "GLOBAL-FX", "category": "Global rules", "rule_text": "Foreign-currency items over $1,000 force human stop.", "is_active": true, "created_at": new Date() },
    { "rule_id": "GLOBAL-DUP", "category": "Global rules", "rule_text": "A duplicate is rejected as a duplicate — no second payment.", "is_active": true, "created_at": new Date() },
    { "rule_id": "GLOBAL-MATH", "category": "Global rules", "rule_text": "The line items + tax must reconcile to total.", "is_active": true, "created_at": new Date() },
    { "rule_id": "GLOBAL-FRAUD", "category": "Global rules", "rule_text": "Fraud-pattern signals are a hard stop.", "is_active": true, "created_at": new Date() }
]);
db.policies.createIndex({ "rule_id": 1 }, { unique: true });


db.autonomy_settings.drop();
db.autonomy_settings.insertMany([
    { "_id": "AUTONOMY-CEILING", "value": 250, "description": "The agent may auto-approve only when the USD amount is <= this value." },
    { "_id": "AUTONOMY-CONFIDENCE", "value": 0.80, "description": "The agent may auto-approve only when its LLM confidence is >= this score." }
]);

print("🎉 MongoDB core tables seeded successfully!");
