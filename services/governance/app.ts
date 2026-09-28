import { DaprServer, DaprClient } from '@dapr/dapr';
import { aiManager, anonymizeInvoice } from './managers/aiManager';
import { applyOverride } from './engines/applyOverride';
import { evaluateInvoiceWithAI } from './engines/evaluateInvoiceWithAI';
import { getPolicies, saveInvoiceToMongo, getPendingInvoices, getFxRate } from './resources/db';
import { RagEngine } from './resources/ragEngine';
import express, { Request, Response } from 'express';

// ---- INLINE TYPES (потом вынесем) ----
import { Invoice, AuditMetadata, normalizeInvoice } from './types/Invoice';
import { Policy } from './types/Policy';


interface ProcessingLock {
    owner: string;
    claimed_at: string;
    data?: { owner: string };
}

type DaprJobBody = {
    dueTime?: string;
    schedule?: string;
    repeats?: number;
    data: {
        "@type": string;
        value: string;
    };
}

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
const daprClient = new DaprClient({ daprHost, daprPort, communicationTimeoutMs: 30000 } as any);
const server = new DaprServer({ serverPort: appPort, client: daprClient } as any);

const POD_NAME: string = process.env.HOSTNAME || 'pod-1';

// ---- Jobs helpers ----
const DAPR_JOBS_BASE = `http://${daprHost}:${daprPort}/v1.0-alpha1/jobs`;

function safeJobName(trackingId: string): string {
    return `reclaim-${trackingId}`.replace(/[^a-zA-Z0-9-_]/g, '-').substring(0, 80);
}

async function daprCreateJobHTTP(name: string, jobBody: DaprJobBody): Promise<void> {
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

async function daprDeleteJobHTTP(name: string): Promise<void> {
    const url = `${DAPR_JOBS_BASE}/${encodeURIComponent(name)}`;
    try {
        await fetch(url, { method: 'DELETE' });
    } catch (_) { }
}

async function createReclaimJob(trackingId: string, invoice: Invoice): Promise<void> {
    const jobName = safeJobName(trackingId);
    const payload: DaprJobBody = {
        dueTime: "5m",
        data: {
            "@type": "type.googleapis.com/google.protobuf.Any",
            "value": Buffer.from(JSON.stringify({ tracking_id: trackingId })).toString('base64')
        },
    };
    try {
        try {
            if ((server as any).jobs?.register) {
                await (server as any).jobs.register(jobName, async () => { await handleReclaimJob(trackingId); });
            }
        } catch (_) { }
        await daprCreateJobHTTP(jobName, payload);
        console.log(`[${trackingId}] Reclaim job ${jobName} created for 5m`);
    } catch (err: any) {
        console.warn(`[${trackingId}] Failed to create reclaim job:`, err.message);
    }
}

async function deleteReclaimJob(trackingId: string): Promise<void> {
    const jobName = safeJobName(trackingId);
    await daprDeleteJobHTTP(jobName);
}

async function handleReclaimJob(trackingId: string): Promise<void> {
    console.log(`[${POD_NAME}] [JOB] reclaim triggered for ${trackingId}`);
    try {
        const existing = await (daprClient as any).state.get(PROCESSING_LOCK_STORE, `governance:processing:${trackingId}`) as ProcessingLock | null;
        if (!existing || !existing.owner) {
            const pending = await getPendingInvoices('PROCESSING', 200);
            const inv = pending.find(i => (i as any).tracking_id === trackingId || (i as any).trackingId === trackingId);
            if (!inv) {
                console.log(`[${trackingId}] reclaim: not in PROCESSING anymore, skip`);
                return;
            }
        }
        const pendingList = await getPendingInvoices('PROCESSING', 200);
        const invoice = pendingList.find(i => (i as any).tracking_id === trackingId);
        if (invoice) {
            const age = Date.now() - new Date(invoice.updated_at || invoice.created_at!).getTime();
            if (age < 4 * 60 * 1000) {
                console.log(`[${trackingId}] reclaim: still fresh (${Math.round(age / 1000)}s), skip`);
                return;
            }
            console.log(`[${trackingId}] reclaim: re-queueing after ${Math.round(age / 1000)}s stuck`);
            await (daprClient as any).pubsub.publish(PUB_SUB_NAME, NOTIFICATION_PENDING_TOPIC, invoice);
        }
    } catch (e: any) {
        console.error(`[${trackingId}] reclaim handler error:`, e.message);
    }
}

async function handleReaperJob(): Promise<void> {
    console.log(`[${POD_NAME}] [JOB] governance-reaper triggered`);
    try {
        const processing = await getPendingInvoices('PROCESSING', 100) as Invoice[];
        const now = Date.now();
        const stuck = processing.filter(i => {
            const ts = new Date(i.updated_at || i.created_at!).getTime();
            return now - ts > 5 * 60 * 1000;
        });
        if (stuck.length === 0) return;
        console.log(`[Reaper] Found ${stuck.length} stuck invoices`);
        for (const inv of stuck) {
            const trackingId = inv.tracking_id;
            if (await claimInvoice(trackingId)) {
                try {
                    await (daprClient as any).pubsub.publish(PUB_SUB_NAME, NOTIFICATION_PENDING_TOPIC, inv);
                } finally {
                    await releaseInvoiceClaim(trackingId);
                }
            }
        }
    } catch (e: any) {
        console.error('[Reaper] error:', e.message);
    }
}

async function resolveFxRate(invoice: Invoice): Promise<number> {
    if (invoice.currency !== 'USD') {
        const rateEntry = await getFxRate(invoice.currency, invoice.date) as any;
        if (rateEntry?.rate) return rateEntry.rate;
    }
    return 1;
}

async function processInvoice(trackingId: string, invoice: Invoice): Promise<void> {
    console.log(`[${trackingId}] Processing by ${POD_NAME}`);
    invoice.status = 'PROCESSING';
    invoice.lockedBy = POD_NAME;
    await saveInvoiceToMongo(invoice);
    await publishInvoiceNotification(invoice, NOTIFICATION_PROCESSED_TOPIC);

    await createReclaimJob(trackingId, invoice);

    try {
        const activeRules = await getPolicies() as Policy[];
        const rate = await resolveFxRate(invoice);
        let aiResult: any;
        try {
            const ragPolicies = await ragEngine.retrieveRelevantPolicies(invoice, activeRules).catch((e: any) => {
                if (e.message.includes('Cannot allocate memory')) {
                    console.warn(`[${trackingId}] RAG OOM, fallback to empty policies`);
                    return [];
                }
                throw e;
            });
            const anonymizedInvoice = anonymizeInvoice(invoice, rate);
            const provider = await aiManager();
            aiResult = await provider.requestModel(trackingId, anonymizedInvoice, ragPolicies);
        } catch (err: any) {
            aiResult = evaluateInvoiceWithAI(invoice, activeRules);
            console.log(`[${trackingId}] AI fallback: ${err.message}`);
        }

        invoice.audit_metadata = applyOverride(aiResult, invoice, activeRules, rate);
        invoice.status = invoice.audit_metadata.recommendation;
        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_PAYMENT_TOPIC);
    } catch (error: any) {
        console.error(`[${trackingId}] Critical failure:`, error.message);
        invoice.status = 'HUMAN_REVIEW';
        invoice.audit_metadata = {
            checked_at: new Date().toISOString(),
            reason: `Governance failure: ${error.message}`,
            triggered_rules: ['SYSTEM-ERROR'],
            recommendation: 'HUMAN_REVIEW',
            confidence: 0
        };
        await saveInvoiceToMongo(invoice);
        await publishInvoiceNotification(invoice, NOTIFICATION_REVIEW_TOPIC);
    } finally {
        await deleteReclaimJob(trackingId);
    }
}

async function claimInvoice(trackingId: string): Promise<boolean> {
    try {
        await (daprClient as any).state.save(PROCESSING_LOCK_STORE, [{
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

async function releaseInvoiceClaim(trackingId: string): Promise<void> {
    try {
        const existing = await (daprClient as any).state.get(PROCESSING_LOCK_STORE, `governance:processing:${trackingId}`) as ProcessingLock | null;
        const owner = existing?.owner || existing?.data?.owner;
        if (owner && owner !== POD_NAME) {
            console.warn(`[${trackingId}] Skip release, owned by ${owner}`);
            return;
        }
        await (daprClient as any).state.delete(PROCESSING_LOCK_STORE, `governance:processing:${trackingId}`);
    } catch (e: any) {
        console.warn(`[${trackingId}] Failed release claim:`, e.message);
    }
}

const queue: { trackingId: string; invoice: Invoice }[] = [];
const queuedInvoiceIds = new Set<string>();
let isProcessing = false;

function enqueueInvoice(invoice: Invoice): void {
    const trackingId = invoice.tracking_id || invoice.id;
    if (!trackingId || queuedInvoiceIds.has(trackingId)) return;
    queuedInvoiceIds.add(trackingId);
    queue.push({ trackingId, invoice });
    processQueue();
}

async function processQueue(): Promise<void> {
    if (isProcessing || queue.length === 0) return;
    isProcessing = true;
    const { trackingId, invoice } = queue.shift()!;
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

async function start(): Promise<void> {
    const app = express();
    app.use(express.json({ type: '*/*' } as any));

    app.get('/dapr/subscribe', (req: Request, res: Response) => {
        res.json([{
            pubsubname: PUB_SUB_NAME,
            topic: NOTIFICATION_PENDING_TOPIC,
            route: `/${PUB_SUB_NAME}/${NOTIFICATION_PENDING_TOPIC}`
        }]);
    });

    app.post(`/${PUB_SUB_NAME}/${NOTIFICATION_PENDING_TOPIC}`, async (req: Request, res: Response) => {
        try {
            const invoice = (req.body as any)?.data ? (req.body as any).data : req.body;
            enqueueInvoice(invoice as Invoice);
            res.json({ status: "SUCCESS" });
        } catch (e: any) {
            console.error('pubsub handler error', e.message);
            res.status(500).json({ status: "RETRY" });
        }
    });

    app.post('/job/:name', async (req: Request, res: Response) => {
        const name = (req.params as any).name as string;
        console.log(`[JOB HTTP] Trigger ${name}`);
        try {
            if (name.startsWith('reclaim-')) {
                const trackingId = name.replace('reclaim-', '');
                await handleReclaimJob(trackingId);
            } else if (name === 'governance-reaper') {
                await handleReaperJob();
            }
            res.sendStatus(200);
        } catch (err: any) {
            console.error(`[job ${name}] error:`, err.message);
            res.sendStatus(500);
        }
    });

    app.get('/health', (req: Request, res: Response) => res.sendStatus(200));

    const httpServer = app.listen(parseInt(appPort), () => {
        console.log(`[governance] Listening on ${appPort} as ${POD_NAME} (express + jobs)`);
    });

    const healthUrl = `http://127.0.0.1:${daprPort}/v1.0/health/ready`;
    for (let i = 0; i < 60; i++) {
        try {
            const r = await fetch(healthUrl);
            if (r.ok) break;
        } catch (_) { }
        await new Promise(r => setTimeout(r, 1000));
    }

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
    } catch (e: any) {
        console.error('Failed to schedule reaper job:', e.message);
    }
}

async function publishInvoiceNotification(inv: Invoice, topic: string): Promise<void> {
    if (!inv) return;
    try { await (daprClient as any).pubsub.publish(PUB_SUB_NAME, topic, inv); }
    catch (e: any) { console.error(`[${inv.tracking_id}] publish ${topic} failed:`, e.message); }
}

export { start, server, daprClient, processInvoice, claimInvoice, releaseInvoiceClaim, publishInvoiceNotification, enqueueInvoice, handleReclaimJob, handleReaperJob, safeJobName, ragEngine };
export type { Invoice, AuditMetadata, Policy };

if (require.main === module) start().catch(console.error);