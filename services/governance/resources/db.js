

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


async function saveAuditRecord(trackingId, correlationId, invoice, recommendation, reason, triggered_rules) {
    const auditRecord = {
        ...invoice,
        status: recommendation,
        audit_metadata: {
            checked_at: new Date().toISOString(),
            reason: reason,
            triggered_rules: triggered_rules || []
        }
    };

    try {
        await client.state.save("mongo-invoices", [
            {
                key: trackingId,
                value: auditRecord
            }
        ]);
        logCompliance("INFO", trackingId, correlationId, `Successfully persisted signed audit record into MongoDB store.`);
    } catch (dbErr) {
        logCompliance("ERROR", trackingId, correlationId, `Failed to save audit record in MongoDB: ${dbErr.message}`);
    }
}

module.exports = { getPolicies, saveAuditRecord };