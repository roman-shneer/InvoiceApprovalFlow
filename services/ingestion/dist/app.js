"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const dapr_1 = require("@dapr/dapr");
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const DAPR_HOST = process.env.DAPR_HOST || 'ingestion-dapr-sidecar';
const DAPR_PORT = process.env.DAPR_PORT || '3500';
const PORT = process.env.PORT || '8001';
const STATE_STORE_NAME = 'approval-state';
const PUB_SUB_NAME = 'approval-pubsub';
const MONGO_STATE_STORE = 'mongo-state';
const MONGO_INVOICES_STORE = 'mongo-invoices';
const NOTIFICATION_PENDING_TOPIC = 'invoice.pending';
const daprClient = new dapr_1.DaprClient({ daprHost: DAPR_HOST, daprPort: DAPR_PORT });
exports.app = (0, express_1.default)();
exports.app.use(express_1.default.json());
exports.app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    next();
});
function logMessage(level, correlationId, message) {
    const log = {
        timestamp: new Date().toISOString(),
        level,
        service: 'ingestion-service',
        correlation_id: correlationId,
        message,
    };
    const formattedMsg = `${JSON.stringify(log)}\n`;
    process.stdout.write(formattedMsg);
    node_fs_1.default.appendFile('server.log', formattedMsg, (err) => {
        if (err) {
            console.error('Error writing log to file:', err);
        }
    });
}
function decodeJwtPayload(token) {
    if (!token) {
        return null;
    }
    try {
        const parts = token.split('.');
        if (parts.length !== 3) {
            return null;
        }
        const base64Url = parts[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = Buffer.from(base64, 'base64').toString('utf8');
        return JSON.parse(jsonPayload);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown JWT decode error';
        console.error('[JWT Error] Failed to decode token payload:', message);
        return null;
    }
}
async function saveInvoiceToMongo(invoice) {
    const pendingInvoice = {
        ...invoice,
        createdAt: new Date().toISOString(),
    };
    try {
        const trackingId = String(invoice.tracking_id ?? 'unknown');
        await daprClient.state.save(MONGO_INVOICES_STORE, [
            {
                key: trackingId,
                value: pendingInvoice,
            },
        ]);
    }
    catch (dbErr) {
        const message = dbErr instanceof Error ? dbErr.message : 'Unknown database error';
        const trackingId = String(invoice.tracking_id ?? 'unknown');
        const correlationId = String(invoice.correlation_id ?? 'unknown');
        console.log(`[${trackingId}] ERROR: ${correlationId}: Failed to save audit record in MongoDB: ${message}`);
    }
}
async function publishInvoiceNotification(pendingInvoice, topic = NOTIFICATION_PENDING_TOPIC) {
    if (!pendingInvoice) {
        return;
    }
    try {
        await daprClient.pubsub.publish(PUB_SUB_NAME, topic, pendingInvoice);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown publish error';
        console.error(`[${String(pendingInvoice.tracking_id)}] Failed to publish invoice processed notification:`, message);
    }
}
async function saveOutboxEvent(eventPayload) {
    const outboxKey = `outbox_${eventPayload.idempotency_key}`;
    const outboxValue = {
        pubsub_name: PUB_SUB_NAME,
        topic: NOTIFICATION_PENDING_TOPIC,
        processed: false,
        payload: eventPayload,
        created_at: new Date().toISOString(),
        correlation_id: eventPayload.correlation_id,
    };
    await daprClient.state.save(MONGO_STATE_STORE, [{ key: outboxKey, value: outboxValue }]);
    return { key: outboxKey, value: outboxValue };
}
async function markOutboxProcessed(outboxKey, outboxValue) {
    await daprClient.state.save(MONGO_STATE_STORE, [
        {
            key: outboxKey,
            value: {
                ...outboxValue,
                processed: true,
                processed_at: new Date().toISOString(),
            },
        },
    ]);
}
async function registerActorReminder(idempotencyKey, eventPayload) {
    try {
        const actorId = new dapr_1.ActorId(idempotencyKey);
        // Governance owns InvoiceActor; Dapr routes this invocation to that actor service.
        const actorClient = daprClient.actor.actor;
        await actorClient.invoke('InvoiceActor', actorId, 'startProcessingTimer', eventPayload);
        logMessage('INFO', eventPayload.correlation_id, `Successfully registered actor reminder for key ${idempotencyKey}`);
    }
    catch (actorErr) {
        const msg = actorErr instanceof Error ? actorErr.message : 'Unknown actor error';
        logMessage('ERROR', eventPayload.correlation_id, `Failed to register actor reminder: ${msg}`);
    }
}
logMessage('INFO', '0', 'Ingestion service bootstrap complete. Listening for incoming traffic.');
exports.app.post('/api/v1/expenses', async (req, res) => {
    const correlationId = String(req.headers['x-correlation-id'] || `corr_${node_crypto_1.default.randomUUID()}`);
    logMessage('INFO', correlationId, 'Received raw invoice submission request.');
    const authHeader = req.headers['authorization'];
    let userPayload = null;
    if (authHeader) {
        let token = null;
        if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1] ?? null;
        }
        userPayload = decodeJwtPayload(token ?? undefined);
    }
    if (!authHeader || !userPayload || userPayload.role !== 'submitter' || !userPayload.exp) {
        logMessage('WARN', correlationId, 'Unauthorized submission attempt.');
        return res.status(403).json({ error: 'Forbidden: Invalid or missing token.' });
    }
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    if (currentUnixTimestamp > userPayload.exp) {
        logMessage('WARN', correlationId, 'Token has expired.');
        return res.status(403).json({ error: 'Forbidden: Token has expired.' });
    }
    logMessage('INFO', correlationId, 'Token is valid.');
    const body = req.body;
    if (!body || !body.id) {
        logMessage('WARN', correlationId, 'Rejected due to invalid JSON schema.');
        return res.status(400).json({ error: 'Invalid schema. Required: id' });
    }
    const vendor = String(body.vendor ?? 'UnknownVendor');
    const invoiceNumber = String(body.invoiceNumber ?? 'NoNumber');
    const total = Number(body.total ?? 0.0);
    const hashString = `${vendor}_${invoiceNumber}_${total}`;
    const idempotencyKey = node_crypto_1.default.createHash('md5').update(hashString).digest('hex');
    try {
        const existingState = (await daprClient.state.get(STATE_STORE_NAME, idempotencyKey));
        if (existingState && Object.keys(existingState).length > 0) {
            const trackingId = String(existingState.tracking_id ?? body.id);
            logMessage('INFO', correlationId, `Duplicate detected: ${idempotencyKey}.`);
            return res.status(200).json({
                tracking_id: trackingId,
                status: String(existingState.status ?? 'PROCESSING'),
                message: 'Duplicate request detected. Invoice is already being processed.',
            });
        }
        const trackingId = String(body.id);
        const category = String(body.category ?? 'General');
        const eventPayload = {
            idempotency_key: idempotencyKey,
            correlation_id: correlationId,
            submitted_at: new Date().toISOString(),
            tracking_id: trackingId,
            submitter: String(body.submitter ?? 'anonymous@example.com'),
            department: String(body.department ?? 'unassigned'),
            vendor,
            vendorKnown: Boolean(body.vendorKnown ?? true),
            invoiceNumber,
            currency: String(body.currency ?? 'USD'),
            category,
            attendees: Number(body.attendees ?? 1),
            lineItems: Array.isArray(body.lineItems) ? body.lineItems : [],
            taxAmount: Number(body.taxAmount ?? 0.0),
            total,
            receiptPresent: Boolean(body.receiptPresent ?? true),
            date: String(body.date ?? new Date().toISOString().split('T')[0]),
            notes: String(body.notes ?? ''),
            scenario: String(body.scenario ?? 'standard-ingest'),
            expected: body.expected ?? null,
            note: body.note ?? null,
            status: 'PENDING',
        };
        registerActorReminder(idempotencyKey, eventPayload).catch((err) => {
            const message = err instanceof Error ? err.message : 'Unknown actor registration error';
            logMessage('ERROR', correlationId, `Failed to register actor reminder for idempotency key ${idempotencyKey}: ${message}`);
        });
        await daprClient.state.save(STATE_STORE_NAME, [
            {
                key: idempotencyKey,
                value: {
                    tracking_id: trackingId,
                    correlation_id: correlationId,
                    status: 'PROCESSING',
                    lockedAt: new Date().getTime(),
                    payload: eventPayload,
                    lockedBy: process.env.HOSTNAME,
                    createdAt: new Date().toISOString(),
                },
            },
        ]);
        const outboxEvent = await saveOutboxEvent(eventPayload);
        logMessage('INFO', correlationId, `Publish notification to ${PUB_SUB_NAME} ${NOTIFICATION_PENDING_TOPIC}.`);
        await publishInvoiceNotification(eventPayload, NOTIFICATION_PENDING_TOPIC);
        await markOutboxProcessed(outboxEvent.key, outboxEvent.value);
        await saveInvoiceToMongo({ ...eventPayload, status: 'PENDING' });
        return res.status(202).json({
            tracking_id: trackingId,
            status: 'ACCEPTED',
            message: 'Invoice submitted successfully and queued for processing.',
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown processing error';
        logMessage('ERROR', correlationId, `Critical failure in ingestion processing: ${message}`);
        const statusCode = typeof error === 'object' && error && 'status' in error ? Number(error.status ?? 500) : 500;
        const errorMessage = statusCode === 500 ? 'Internal Server Error' : message;
        return res.status(statusCode).json({ error: errorMessage });
    }
});
exports.app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});
module.exports = exports.app;
module.exports.app = exports.app;
if (process.env.NODE_ENV !== 'test') {
    exports.app.listen(Number(PORT), '0.0.0.0', () => {
        console.log(`🚀 Ingestion Service successfully started on port ${PORT}`);
    });
}
exports.default = exports.app;
