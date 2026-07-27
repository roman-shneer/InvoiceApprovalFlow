const express = require('express');
const { DaprServer, DaprClient } = require('@dapr/dapr');
const { aiManager, anonymizeInvoice } = require('./managers/aiManager');
const { applyOverride } = require('./engines/applyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { getPolicies, saveInvoiceToMongo, getPendingInvoices, getFxRate } = require('./resources/db');
const { RagEngine } = require('./resources/ragEngine');
const ragEngine = new RagEngine();
const appPort = process.env.APP_PORT || "8002";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const PUB_SUB_NAME = "approval-pubsub";
const PUB_SUB_TOPIC = 'invoice.submitted'
const PUB_SUB_TOPIC_PENDING = 'invoice.pending';
const NOTIFICATION_PROCESSED_TOPIC = "invoice.processed";

const daprClient = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
});

const server = new DaprServer({
    serverHost: "0.0.0.0",
    serverPort: appPort,
    client: daprClient
});


async function resolveFxRate(invoice) {
    if (invoice.currency !== 'USD') {
        const rateEntry = await getFxRate(invoice.currency, invoice.date);
        if (rateEntry && rateEntry.rate) {
            return rateEntry.rate;
        }
    }

    return 1;
}
async function processInvoice(trackingId, invoice) {
    const correlationId = invoice.correlation_id || "unknown";
    // Initialize empty buckets to accumulate ALL audit findings across the matrix boundaries
    let allTriggeredRules = [];
    let allReasons = [];
    console.log(`[${trackingId}] Processing`);
    await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);
    try {
        const activeRules = await getPolicies();
        const rate = await resolveFxRate(invoice);
        let aiResult;
        try {

            const ragPolicies = await ragEngine.retrieveRelevantPolicies(invoice, activeRules);
            const anonymizedInvoice = anonymizeInvoice(invoice, rate);
            const provider = await aiManager();
            aiResult = await provider.requestModel(trackingId, anonymizedInvoice, ragPolicies);

        } catch (err) {
            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
            console.log(`[${trackingId}] ERROR: AI failure context: ${err.message}. Triggered static heuristics.`);
        }


        invoice.audit_metadata = applyOverride(aiResult, invoice, activeRules, rate);

        invoice.status = invoice.audit_metadata.recommendation;
        const aiApproved = invoice.status === 'AUTO_APPROVE';


        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);
    } catch (error) {
        console.error(`[${trackingId}] Critical failure inside background worker:`, error.message);
        try {
            invoice.status = 'HUMAN_REVIEW';
            invoice.audit_metadata = {
                checked_at: new Date().toISOString(),
                reason: `Governance processing failure: ${error.message}`,
                triggered_rules: ['SYSTEM-ERROR'],
                confidence: 0
            };
            await saveInvoiceToMongo(invoice);
            await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);
        } catch (persistErr) {
            console.error(`[${trackingId}] Failed to persist fallback HUMAN_REVIEW state:`, persistErr.message);
        }
    }

}

async function startServerWithRetry() {
    const maxAttempts = Number(process.env.DAPR_START_MAX_ATTEMPTS || 30);
    const delayMs = Number(process.env.DAPR_START_RETRY_DELAY_MS || 2000);

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await server.start();
            return;
        } catch (err) {
            const msg = err && err.message ? err.message : String(err);
            const isSidecarBootRace = msg.includes('DAPR_SIDECAR_COULD_NOT_BE_STARTED');

            if (!isSidecarBootRace || attempt === maxAttempts) {
                throw err;
            }

            console.warn(`[governance-startup] Dapr sidecar not ready (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
}

async function start() {
    //subscribe to the "invoice.pending" topic to process pending invoices
    await server.pubsub.subscribe(
        PUB_SUB_NAME,
        PUB_SUB_TOPIC_PENDING,
        async (eventData) => {
            const invoice = eventData && eventData.data ? eventData.data : eventData;
            const trackingId = invoice.tracking_id || invoice.id;
            await processInvoice(trackingId, invoice);
            console.log(`[${invoice.tracking_id}] Incoming invoice.pending received via Pub/Sub`);
            return "SUCCESS";
        }
    )
    await startServerWithRetry();
}

async function saveToFile(invoice, message) {
    const deadLetterPayload = {
        failed_at: new Date().toISOString(),
        error: message,
        invoice: invoice
    };

    fs.appendFile(
        path.join(__dirname, 'failed-invoices.jsonl'),
        JSON.stringify(deadLetterPayload) + '\n',
        'utf8'
    ).then(() => {
        console.log(`[${invoice.tracking_id || invoice.id || "unknown"}] The emergency invoice was successfully saved locally to disk.`);
    }).catch(fsErr => {
        console.error(`[${invoice.tracking_id || invoice.id || "unknown"}] CATASTROPHE: Even the disk is not writable!`, fsErr.message);
    });
}



async function publishInvoiceNotification(pendingInvoice, topic = NOTIFICATION_PROCESSED_TOPIC) {
    if (!pendingInvoice) return;
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, topic, pendingInvoice);
    } catch (err) {
        console.error(`[${pendingInvoice?.tracking_id}] Failed to publish invoice processed notification:`, err.message);
    }
}

module.exports = { start, getPendingInvoices, server, daprClient };

if (require.main === module) {
    start().catch(console.error);
}
