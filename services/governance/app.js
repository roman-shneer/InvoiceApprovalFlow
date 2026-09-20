const { DaprServer, DaprClient } = require('@dapr/dapr');
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

// ---- Jobs helpers (HTTP API - works with any SDK version) ----
const DAPR_JOBS_BASE = `http://${daprHost}:${daprPort}/v1.0-alpha1/jobs`;

function safeJobName(trackingId) {
    return `reclaim-${trackingId}`.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 80);
}

async function daprCreateJobHTTP(name, jobBody) {
    const url = `${DAPR_JOBS_BASE}/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(jobBody)
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${res.status} ${txt}`);
    }
}

async function daprDeleteJobHTTP(name) {
    const url = `${DAPR_JOBS_BASE}/${encodeURIComponent(name)}`;
    try {
        await fetch(url, { method: 'DELETE' });
    } catch (_) { }
}

async function createReclaimJob(trackingId, invoice) {
    const jobName = safeJobName(trackingId);
    const payload = {
        dueTime: "5m",
        data: {
            "@type": "type.googleapis.com/google.protobuf.Any",
            "value": Buffer.from(JSON.stringify({ tracking_id: trackingId })).toString('base64')
        },
        // Dapr 1.15: overwrite is implicit on POST, failurePolicy optional
    };
    try {
        // also register handler dynamically if SDK supports it
        try {
            if (server.jobs && server.jobs.register) {
                await server.jobs.register(jobName, async () => { await handleReclaimJob(trackingId); });
            }
        } catch (_) { }
        await daprCreateJobHTTP(jobName, payload);
        console.log(`[${trackingId}] Reclaim job ${jobName} created for 5m`);
    } catch (err) {
        console.warn(`[${trackingId}] Failed to create reclaim job:`, err.message);
    }
}

async function deleteReclaimJob(trackingId) {
    const jobName = safeJobName(trackingId);
    await daprDeleteJobHTTP(jobName);
}

async function handleReclaimJob(trackingId) {
    console.log(`[${POD_NAME}] [JOB] reclaim triggered for ${trackingId}`);
    try {
        const existing = await daprClient.state.get(PROCESSING_LOCK_STORE, `governance:processing:${trackingId}`);
        if (!existing || !existing.owner) {
            // no lock = maybe still PROCESSING in mongo? check mongo
            const pending = await getPendingInvoices('PROCESSING', 200);
            const inv = pending.find(i => i.tracking_id === trackingId);
            if (!inv) {
                console.log(`[${trackingId}] reclaim: not in PROCESSING anymore, skip`);
                return;
            }
        }
        // re-publish to pending topic to reprocess
        const pendingList = await getPendingInvoices('PROCESSING', 200);
        const invoice = pendingList.find(i => i.tracking_id === trackingId);
        if (invoice) {
            const age = Date.now() - new Date(invoice.updated_at || invoice.created_at).getTime();
            if (age < 4 * 60 * 1000) {
                console.log(`[${trackingId}] reclaim: still fresh (${Math.round(age / 1000)}s), skip`);
                return;
            }
            console.log(`[${trackingId}] reclaim: re-queueing after ${Math.round(age / 1000)}s stuck`);
            await daprClient.pubsub.publish(PUB_SUB_NAME, NOTIFICATION_PENDING_TOPIC, invoice);
        }
    } catch (e) {
        console.error(`[${trackingId}] reclaim handler error:`, e.message);
    }
}

async function handleReaperJob() {
    console.log(`[${POD_NAME}] [JOB] governance-reaper triggered`);
    try {
        const processing = await getPendingInvoices('PROCESSING', 100);
        const now = Date.now();
        const stuck = processing.filter(i => {
            const ts = new Date(i.updated_at || i.created_at).getTime();
            return now - ts > 5 * 60 * 1000;
        });
        if (stuck.length === 0) return;
        console.log(`[Reaper] Found ${stuck.length} stuck invoices`);
        for (const inv of stuck) {
            const trackingId = inv.tracking_id;
            if (await claimInvoice(trackingId)) {
                try {
                    await daprClient.pubsub.publish(PUB_SUB_NAME, NOTIFICATION_PENDING_TOPIC, inv);
                } finally {
                    await releaseInvoiceClaim(trackingId);
                }
            }
        }
    } catch (e) {
        console.error('[Reaper] error:', e.message);
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

    // create reclaim job BEFORE AI work
    await createReclaimJob(trackingId, invoice);

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
        await deleteReclaimJob(trackingId);
    }
}

// ---- FIXED CLAIM ----
async function claimInvoice(trackingId) {
    try {
        await daprClient.state.save(PROCESSING_LOCK_STORE, [{
            key: `governance:processing:${trackingId}`,
            value: { owner: POD_NAME, claimed_at: new Date().toISOString() },
            metadata: { ttlInSeconds: '3600' },
            options: { concurrency: 'first-write' }
        }]);
        return true;
    } catch (error) {
        return false;
    }
}

async function releaseInvoiceClaim(trackingId) {
    try {
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
    // ---- Express app that handles BOTH pubsub and Jobs (works with any SDK version) ----
    const express = require('express');
    const app = express();
    app.use(express.json({ type: '*/*' }));

    // Dapr subscription discovery
    app.get('/dapr/subscribe', (req, res) => {
        res.json([{
            pubsubname: PUB_SUB_NAME,
            topic: NOTIFICATION_PENDING_TOPIC,
            route: `/${PUB_SUB_NAME}/${NOTIFICATION_PENDING_TOPIC}`
        }]);
    });

    // PubSub handler
    app.post(`/${PUB_SUB_NAME}/${NOTIFICATION_PENDING_TOPIC}`, async (req, res) => {
        try {
            const invoice = req.body?.data ? req.body.data : req.body;
            enqueueInvoice(invoice);
            res.json({ status: "SUCCESS" });
        } catch (e) {
            console.error('pubsub handler error', e.message);
            res.status(500).json({ status: "RETRY" });
        }
    });

    // Jobs handler - Dapr scheduler POSTs here: /job/{name}
    app.post('/job/:name', async (req, res) => {
        const name = req.params.name;
        console.log(`[JOB HTTP] Trigger ${name}`);
        try {
            if (name.startsWith('reclaim-')) {
                const trackingId = name.replace('reclaim-', '');
                await handleReclaimJob(trackingId);
            } else if (name === 'governance-reaper') {
                await handleReaperJob();
            }
            res.sendStatus(200);
        } catch (err) {
            console.error(`[job ${name}] error:`, err.message);
            res.sendStatus(500);
        }
    });

    app.get('/health', (req, res) => res.sendStatus(200));

    // Start HTTP server (replaces DaprServer.start)
    const httpServer = app.listen(parseInt(appPort), () => {
        console.log(`[governance] Listening on ${appPort} as ${POD_NAME} (express + jobs)`);
    });

    // Wait for sidecar to be ready
    const healthUrl = `http://127.0.0.1:${daprPort}/v1.0/health/ready`;
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(healthUrl);
            if (r.ok) break;
        } catch (_) { }
        await new Promise(r => setTimeout(r, 1000));
    }

    // schedule global reaper job
    try {
        await daprCreateJobHTTP("governance-reaper", {
            schedule: "@every 1m",
            repeats: 0,
            data: {
                "@type": "type.googleapis.com/google.protobuf.Any",
                "value": Buffer.from(JSON.stringify({ trigger: "reaper" })).toString('base64')
            }
        });
        console.log(`[${POD_NAME}] Global reaper job scheduled @every 1m`);
    } catch (e) {
        console.error('Failed to schedule reaper job:', e.message);
    }
}

async function publishInvoiceNotification(inv, topic) {
    if (!inv) return;
    try { await daprClient.pubsub.publish(PUB_SUB_NAME, topic, inv); }
    catch (e) { console.error(`[${inv.tracking_id}] publish ${topic} failed:`, e.message); }
}

module.exports = { start, server, daprClient };
if (require.main === module) start().catch(console.error);
