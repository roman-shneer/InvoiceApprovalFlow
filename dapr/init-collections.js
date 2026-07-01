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


db.policies.drop();
db.policies.insertMany([
    {
        "_id": "management-service||MEAL-01",
        "_key": "MEAL-01",
        "value": JSON.stringify({ "rule_id": "MEAL-01", "category": "Meals & Entertainment", "rule_text": "Personal/team meals are reimbursable up to $75 per attendee.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||MEAL-02",
        "_key": "MEAL-02",
        "value": JSON.stringify({ "rule_id": "MEAL-02", "category": "Meals & Entertainment", "rule_text": "Client entertainment over $500 requires a business justification.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||MEAL-03",
        "_key": "MEAL-03",
        "value": JSON.stringify({ "rule_id": "MEAL-03", "category": "Meals & Entertainment", "rule_text": "Alcohol-only receipts are not reimbursable.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||TRAVEL-01",
        "_key": "TRAVEL-01",
        "value": JSON.stringify({ "rule_id": "TRAVEL-01", "category": "Travel", "rule_text": "Economy flights and standard hotels are policy-eligible.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||TRAVEL-02",
        "_key": "TRAVEL-02",
        "value": JSON.stringify({ "rule_id": "TRAVEL-02", "category": "Travel", "rule_text": "Any single travel expense over $1,500 requires manager approval.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||TRAVEL-03",
        "_key": "TRAVEL-03",
        "value": JSON.stringify({ "rule_id": "TRAVEL-03", "category": "Travel", "rule_text": "First/business-class travel always requires approval.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||SAAS-01",
        "_key": "SAAS-01",
        "value": JSON.stringify({ "rule_id": "SAAS-01", "category": "Software / SaaS", "rule_text": "Subscriptions are policy-eligible up to $200 / month.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||HW-01",
        "_key": "HW-01",
        "value": JSON.stringify({ "rule_id": "HW-01", "category": "Hardware", "rule_text": "Hardware purchases are policy-eligible up to $1,000.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||HW-02",
        "_key": "HW-02",
        "value": JSON.stringify({ "rule_id": "HW-02", "category": "Hardware", "rule_text": "Hardware over $1,000 is a Capital expense -> always human-approved.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||GLOBAL-RECEIPT",
        "_key": "GLOBAL-RECEIPT",
        "value": JSON.stringify({ "rule_id": "GLOBAL-RECEIPT", "category": "Global rules", "rule_text": "A receipt is required for any expense over $25.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||GLOBAL-VENDOR",
        "_key": "GLOBAL-VENDOR",
        "value": JSON.stringify({ "rule_id": "GLOBAL-VENDOR", "category": "Global rules", "rule_text": "A new / unknown vendor is always reviewed by a human.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||GLOBAL-FX",
        "_key": "GLOBAL-FX",
        "value": JSON.stringify({ "rule_id": "GLOBAL-FX", "category": "Global rules", "rule_text": "Foreign-currency items over $1,000 force human stop.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||GLOBAL-DUP",
        "_key": "GLOBAL-DUP",
        "value": JSON.stringify({ "rule_id": "GLOBAL-DUP", "category": "Global rules", "rule_text": "A duplicate is rejected as a duplicate — no second payment.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||GLOBAL-MATH",
        "_key": "GLOBAL-MATH",
        "value": JSON.stringify({ "rule_id": "GLOBAL-MATH", "category": "Global rules", "rule_text": "The line items + tax must reconcile to total.", "is_active": true, "created_at": new Date() })
    },
    {
        "_id": "management-service||GLOBAL-FRAUD",
        "_key": "GLOBAL-FRAUD",
        "value": JSON.stringify({ "rule_id": "GLOBAL-FRAUD", "category": "Global rules", "rule_text": "Fraud-pattern signals are a hard stop.", "is_active": true, "created_at": new Date() })
    }
]);


db.policies.createIndex({ "_key": 1 }, { unique: true });


print("🎉 MongoDB core tables seeded successfully!");
