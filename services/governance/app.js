const { DaprServer, DaprClient, ActorId, ActorProxyBuilder } = require('@dapr/dapr');
const { InvoiceActor } = require('./engines/InvoiceActor');
const { aiManager, anonymizeInvoice } = require('./managers/aiManager');
const { applyOverride } = require('./engines/applyOverride');
const { evaluateInvoiceWithAI } = require('./engines/evaluateInvoiceWithAI');
const { getPolicies, saveInvoiceToMongo, getPendingInvoices, getFxRate } = require('./resources/db');

const { RagEngine } = require('./resources/ragEngine');
const ragEngine = new RagEngine();



const PUB_SUB_NAME = "approval-pubsub";
const NOTIFICATION_PENDING_TOPIC = 'invoice.pending';
const NOTIFICATION_PROCESSED_TOPIC = "invoice.processed";
const NOTIFICATION_REVIEW_TOPIC = "invoice.review";
const NOTIFICATION_PAYMENT_TOPIC = "invoice.payment";
//dapr init
const appPort = process.env.APP_PORT || "8002";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

const daprClient = new DaprClient({ daprHost, daprPort, communicationTimeoutMs: 30000 });

const server = new DaprServer({
    serverPort: appPort,
    client: daprClient
});



const POD_NAME = process.env.HOSTNAME || 'pod-1';

async function actorStopTimer(idempotency_key) {
    if (!idempotency_key) return;
    try {
        const actorId = new ActorId(idempotency_key);
        const builder = new ActorProxyBuilder(InvoiceActor, daprClient);
        const actorProxy = builder.build(actorId);
        await actorProxy.stopTimer();

        console.log(`[${POD_NAME}] Successfully invoked stop timer for actor: ${idempotency_key}`);
    } catch (err) {
        console.error(`[${POD_NAME}] Failed to invoke stop timer for actor ${idempotency_key}:`, err.message);
    }
}
/* TODO delete
async function reconcileStuckInvoicesOnBoot() {
    // 1. Делаем быстрый точечный запрос в вашу MongoDB (db.js)
    // Ищем только те инвойсы, которые зависли в 'PROCESSING'
    const stuckInvoices = await getPendingInvoices(); // Или ваш метод поиска по статусу PROCESSING

    if (!stuckInvoices || stuckInvoices.length === 0) return;

    console.log(`[Boot] Found ${stuckInvoices.length} stuck invoices in PROCESSING status. Restoring timers...`);

    for (const invoice of stuckInvoices) {
        try {
            const actorId = new ActorId(invoice.idempotency_key);
            const builder = new ActorProxyBuilder(InvoiceActor, daprClient);
            const actorProxy = builder.build(actorId);

            // Запускаем таймер заново! Если будильник в Scheduler уже был — Dapr просто обновит его.
            // Если сгорел — создаст заново.
            await actorProxy.startProcessingTimer(invoice);
            console.log(`[Boot] Successfully restored actor safety timer for invoice: ${invoice.tracking_id}`);
        } catch (err) {
            console.error(`[Boot] Failed to restore timer for ${invoice.tracking_id}:`, err.message);
        }
    }
}*/
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



        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_PAYMENT_TOPIC);
        await actorStopTimer(invoice.idempotency_key);


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
            await actorStopTimer(invoice.idempotency_key);
            await publishInvoiceNotification(invoice, NOTIFICATION_REVIEW_TOPIC);
        } catch (persistErr) {
            console.error(`[${trackingId}] Failed to persist fallback HUMAN_REVIEW state:`, persistErr.message);
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
        processQueue();
    }
}
async function start() {
    await server.actor.init();
    await server.actor.registerActor(InvoiceActor);

    await server.pubsub.subscribe(
        PUB_SUB_NAME,
        NOTIFICATION_PENDING_TOPIC,
        async (eventData) => {
            const invoice = eventData?.data ? eventData.data : eventData;
            const trackingId = invoice.tracking_id || invoice.id;
            queue.push({ trackingId, invoice });
            processQueue();
            return "SUCCESS";
        },
        undefined,
        { concurrency: "1" }
    );
    await server.start();
    console.log(`[governance] Listening on ${appPort}`)
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
