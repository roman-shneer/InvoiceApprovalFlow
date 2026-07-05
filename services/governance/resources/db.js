

const { DaprClient } = require('@dapr/dapr');
const { logCompliance } = require('./../utils/logCompliance');
const daprHost = "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

const client = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
});


async function getPolicies() {
    const response = await client.state.query("mongo-policies", {
        filter: {},
        page: { limit: 100 }
    });

    const activeRules = response.results.map(item => {
        return item.data || item.value;
    });
    return activeRules;
}


async function saveAuditRecord(trackingId, correlationId, recommendation, reason, triggered_rules) {
    try {
        const existingRecord = await client.state.get("mongo-invoices", trackingId);
        if (!existingRecord) {
            logCompliance("ERROR", trackingId, correlationId, `No existing invoice record found for tracking_id ${trackingId}.`);
            return;
        }

        const invoice = typeof existingRecord === 'string' ? JSON.parse(existingRecord) : existingRecord;
        console.log("recommendation", recommendation);
        invoice.status = recommendation;
        invoice.audit_metadata = {
            ...(invoice.audit_metadata || {}),
            checked_at: new Date().toISOString(),
            reason: reason,
            triggered_rules: triggered_rules || []
        };

        await client.state.save("mongo-invoices", [
            {
                key: trackingId,
                value: invoice
            }
        ]);
        logCompliance("INFO", trackingId, correlationId, `Successfully updated audit fields on MongoDB invoice record.`);
    } catch (dbErr) {
        logCompliance("ERROR", trackingId, correlationId, `Failed to update audit record in MongoDB: ${dbErr.message}`);
    }
}


async function saveInvoiceToMongo(invoice) {

    const pendingInvoice = {
        ...invoice,
        status: "PENDING",
        createdAt: new Date().toISOString()
    };
    try {
        await client.state.save("mongo-invoices", [
            {
                key: invoice.tracking_id,
                value: pendingInvoice
            }
        ]);
        logCompliance("INFO", invoice.tracking_id, invoice.correlation_id, `Successfully registered record into MongoDB store.`);
    } catch (dbErr) {
        logCompliance("ERROR", invoice.tracking_id, invoice.correlation_id, `Failed to save audit record in MongoDB: ${dbErr.message}`);
    }
}

module.exports = { getPolicies, saveAuditRecord, saveInvoiceToMongo };