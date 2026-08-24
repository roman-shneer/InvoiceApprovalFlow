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


const NOTIFICATION_PENDING_TOPIC = 'invoice.pending';
const NOTIFICATION_PROCESSED_TOPIC = "invoice.processed";
const NOTIFICATION_REVIEW_TOPIC = "invoice.review";
const NOTIFICATION_PAYMENT_TOPIC = "invoice.payment";
//dapr init
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



const POD_NAME = process.env.HOSTNAME || 'pod-1';
const STATE_STORE = 'approval-state';
const LEADER_KEY = 'leader:reclaimer';

let isLeader = false;

// 1. Try to become leader via Dapr State only - no Redis
async function electLeader() {
    try {
        const [entry] = await daprClient.state.getBulk(STATE_STORE, [LEADER_KEY]);

        if (!entry?.data || Date.now() - entry.data.ts > 30000) {
            // no leader or expired - try to take it
            await daprClient.state.save(STATE_STORE, [{
                key: LEADER_KEY,
                value: { pod: POD_NAME, ts: Date.now() },
                etag: entry?.etag,
                options: entry?.data ? undefined : { concurrency: 'first-write' }
            }]);
            if (!isLeader) console.log(`[${POD_NAME}] I'm LEADER now`);
            isLeader = true;
        } else if (entry.data.pod === POD_NAME) {
            // renew my leadership
            await daprClient.state.save(STATE_STORE, [{
                key: LEADER_KEY,
                value: { pod: POD_NAME, ts: Date.now() },
                etag: entry.etag
            }]);
            isLeader = true;
        } else {
            isLeader = false;
        }
    } catch {
        isLeader = false;
    }
}
console.log("POD_NAME:", POD_NAME);



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
    invoice.status = 'PROCESSING';
    await saveInvoiceToMongo(invoice);
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
        await publishInvoiceNotification(invoice, NOTIFICATION_PAYMENT_TOPIC);
        //mark as done in state store to prevent reprocessing
        await daprClient.state.save(STATE_STORE_NAME, [{
            key: invoice.idempotency_key,
            value: { tracking_id: trackingId, correlation_id: correlationId, status: 'DONE' },
            metadata: { ttlInSeconds: '86400' }
        }]);
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
            await publishInvoiceNotification(invoice, NOTIFICATION_REVIEW_TOPIC);
        } catch (persistErr) {
            console.error(`[${trackingId}] Failed to persist fallback HUMAN_REVIEW state:`, persistErr.message);
        }
    }

}

async function reclaim() {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const result = await daprClient.state.query(STATE_STORE_NAME, {
        filter: {
            AND: [
                { EQ: { status: 'PROCESSING' } },
                { LT: { lockedAt: cutoff } }
            ]
        },
        page: { limit: 20 }
    });

    for (const item of result.results) {
        try {
            await daprClient.state.save(STATE_STORE_NAME, [{
                key: item.key,
                value: { ...item.data, lockedBy: process.env.HOSTNAME, lockedAt: new Date().toISOString() },
                etag: item.etag,
                options: { concurrency: 'first-write' }
            }]);

            console.log(`Reposting stucked ${item.key}`);
            await daprClient.pubsub.publish("approval-pubsub", "invoice-pending", item.data.payload);

        } catch (e) {
            continue;
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

const queue = [];
let isProcessing = false;

async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { trackingId, invoice } = queue.shift();

    try {
        await processInvoice(trackingId, invoice);
    } finally {
        isProcessing = false;
        processQueue(); // берем следующий
    }
}

async function start() {
    await server.pubsub.subscribe(
        PUB_SUB_NAME,
        NOTIFICATION_PENDING_TOPIC, // 'invoice.pending'
        async (eventData) => {
            const invoice = eventData && eventData.data ? eventData.data : eventData;
            const trackingId = invoice.tracking_id || invoice.id;

            console.log(`[${trackingId}] Queued. Queue size: ${queue.length + 1}`);
            queue.push({ trackingId, invoice });
            processQueue();

            return "SUCCESS";
        },
        undefined,
        { concurrency: "1" }
    );

    await startServerWithRetry();
    setInterval(electLeader, 10000);
    setInterval(reclaim, 2 * 60 * 1000); // every 2 min, only leader will actually run
    electLeader();
}

/*
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

*/

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
