const { DaprServer, DaprClient, ActorId, ActorProxyBuilder } = require('@dapr/dapr');
const { InvoiceActor } = require('./engines/invoiceActor');
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
const PROCESSING_LOCK_STORE = 'approval-state';

const appPort = process.env.APP_PORT || "8002";
const daprHost = process.env.DAPR_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";
const daprClient = new DaprClient({ daprHost, daprPort, communicationTimeoutMs: 30000 });
const server = new DaprServer({ serverPort: appPort, client: daprClient });

const POD_NAME = process.env.HOSTNAME || 'pod-1';
// Только 1 pod делает реплей, чтобы не было гонки. Поставь ENABLE_REPLAY=true только на 1 реплике или через Job
const ENABLE_REPLAY = process.env.ENABLE_REPLAY === 'true';

async function actorStopTimer(idempotency_key) {
    if (!idempotency_key) return;
    try {
        const actorId = new ActorId(idempotency_key);
        const builder = new ActorProxyBuilder(InvoiceActor, daprClient);
        const actorProxy = builder.build(actorId);
        await actorProxy.stopTimer();
    } catch (err) {
        // не валим обработку если таймер уже сгорел
        if (!err.message.includes('not found')) {
            console.error(`[${POD_NAME}] Failed stop timer ${idempotency_key}:`, err.message);
        }
    }
}

async function resolveFxRate(invoice) {
    if (invoice.currency !== 'USD') {
        const rateEntry = await getFxRate(invoice.currency, invoice.date);
        if (rateEntry?.rate) return rateEntry.rate;
    }
    return 1;
}

async function processInvoice(trackingId, invoice) {
    console.log(`[${trackingId}] Processing by ${POD_NAME}`);
    invoice.status = 'PROCESSING';
    invoice.lockedBy = POD_NAME;
    await saveInvoiceToMongo(invoice);
    await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);

    try {
        const activeRules = await getPolicies();
        const rate = await resolveFxRate(invoice);
        let aiResult;
        try {
            const ragPolicies = await ragEngine.retrieveRelevantPolicies(invoice, activeRules).catch(e => {
                if (e.message.includes('Cannot allocate memory')) {
                    console.warn(`[${trackingId}] RAG OOM, fallback to empty policies`);
                    return [];
                }
                throw e;
            });
            const anonymizedInvoice = anonymizeInvoice(invoice, rate);
            const provider = await aiManager();
            aiResult = await provider.requestModel(trackingId, anonymizedInvoice, ragPolicies);
        } catch (err) {
            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
            console.log(`[${trackingId}] AI fallback: ${err.message}`);
        }

        invoice.audit_metadata = applyOverride(aiResult, invoice, activeRules, rate);
        invoice.status = invoice.audit_metadata.recommendation;
        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_PAYMENT_TOPIC);
    } catch (error) {
        console.error(`[${trackingId}] Critical failure:`, error.message);
        invoice.status = 'HUMAN_REVIEW';
        invoice.audit_metadata = {
            checked_at: new Date().toISOString(),
            reason: `Governance failure: ${error.message}`,
            triggered_rules: ['SYSTEM-ERROR'],
            confidence: 0
        };
        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_REVIEW_TOPIC);
    } finally {
        await actorStopTimer(invoice.idempotency_key);
    }
}

// ---- FIXED CLAIM ----
async function claimInvoice(trackingId) {
    // 1. Атомарный лок в Redis с first-write - работает между подами
    try {
        await daprClient.state.save(PROCESSING_LOCK_STORE, [{
            key: `governance:processing:${trackingId}`,
            value: { owner: POD_NAME, claimed_at: new Date().toISOString() },
            metadata: { ttlInSeconds: '3600' }, // был 900 - мало, ставим 1 час
            options: { concurrency: 'first-write' }
        }]);
        return true; // забрали
    } catch (error) {
        // ключ уже есть - кто-то другой обрабатывает
        return false;
    }
}

async function releaseInvoiceClaim(trackingId) {
    try {
        // Читаем кто владелец, чтобы не удалить чужой лок
        const existing = await daprClient.state.get(PROCESSING_LOCK_STORE, `governance:processing:${trackingId}`);
        const owner = existing?.owner || existing?.data?.owner;
        if (owner && owner !== POD_NAME) {
            console.warn(`[${trackingId}] Skip release, owned by ${owner}`);
            return;
        }
        await daprClient.state.delete(PROCESSING_LOCK_STORE, `governance:processing:${trackingId}`);
    } catch (e) {
        console.warn(`[${trackingId}] Failed release claim:`, e.message);
    }
}

const queue = [];
const queuedInvoiceIds = new Set();
let isProcessing = false;

function enqueueInvoice(invoice) {
    const trackingId = invoice.tracking_id || invoice.id;
    if (!trackingId || queuedInvoiceIds.has(trackingId)) return;
    queuedInvoiceIds.add(trackingId);
    queue.push({ trackingId, invoice });
    processQueue();
}

async function processQueue() {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { trackingId, invoice } = queue.shift();
    try {
        if (await claimInvoice(trackingId)) {
            try {
                await processInvoice(trackingId, invoice);
            } finally {
                await releaseInvoiceClaim(trackingId);
            }
        } else {
            console.log(`[${trackingId}] Skipped, already claimed by another pod`);
        }
    } finally {
        queuedInvoiceIds.delete(trackingId);
        isProcessing = false;
        if (queue.length > 0) setImmediate(processQueue);
    }
}

async function replayUnfinishedInvoices() {
    if (!ENABLE_REPLAY) {
        console.log(`[Boot] Replay disabled on ${POD_NAME} (set ENABLE_REPLAY=true to enable)`);
        return;
    }
    try {
        const [pending, processing] = await Promise.all([
            getPendingInvoices('PENDING', 50),
            getPendingInvoices('PROCESSING', 50)
        ]);
        console.log(`[Boot] Replaying ${pending.length + processing.length} unfinished`);
        for (const inv of [...pending, ...processing]) enqueueInvoice(inv);
    } catch (e) {
        console.error('[Boot] Replay failed:', e.message);
    }
}

async function startDaprServerWithRetry() {
    try { await server.start(); return; } catch (e) {
        if (!String(e.message).includes('DAPR_SIDECAR_COULD_NOT_BE_STARTED')) throw e;
    }
    const healthUrl = `http://127.0.0.1:${daprPort}/v1.0/health/ready`;
    for (; ;) {
        try {
            const r = await fetch(healthUrl);
            if (!r.ok) throw new Error(r.status);
            await daprClient.start(); return;
        } catch {
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

async function start() {
    await server.actor.init();
    await server.actor.registerActor(InvoiceActor);
    await server.pubsub.subscribe(PUB_SUB_NAME, NOTIFICATION_PENDING_TOPIC, async (data) => {
        const invoice = data?.data ? data.data : data;
        enqueueInvoice(invoice);
        return "SUCCESS";
    }, undefined, { concurrency: "1" });

    await startDaprServerWithRetry();
    console.log(`[governance] Listening on ${appPort} as ${POD_NAME}`);
    await replayUnfinishedInvoices();
}

async function publishInvoiceNotification(inv, topic) {
    if (!inv) return;
    try { await daprClient.pubsub.publish(PUB_SUB_NAME, topic, inv); }
    catch (e) { console.error(`[${inv.tracking_id}] publish ${topic} failed:`, e.message); }
}

module.exports = { start, server, daprClient };
if (require.main === module) start().catch(console.error);