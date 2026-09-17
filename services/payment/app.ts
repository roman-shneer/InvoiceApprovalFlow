import { DaprClient, DaprServer } from '@dapr/dapr';

const APP_PORT = process.env.APP_PORT || '8010';
const DAPR_HOST = process.env.DAPR_HOST || '127.0.0.1';
const DAPR_PORT = process.env.DAPR_HTTP_PORT || '3500';
const PUB_SUB = 'approval-pubsub';
const BUDGET_STORE = 'mongo-budgets';
const DEFAULT_BUDGET_AMOUNT = 5000;
const INVOICE_SAVE_MAX_RETRIES = Number.parseInt(process.env.INVOICE_SAVE_MAX_RETRIES || '5', 10);
const INVOICE_SAVE_BASE_DELAY_MS = Number.parseInt(process.env.INVOICE_SAVE_BASE_DELAY_MS || '150', 10);

type JsonRecord = Record<string, any>;
type PaymentResult = 'SUCCESS' | 'RETRY' | 'REJECT';
type DaprEvent = { data?: Invoice } | Invoice;
type Invoice = JsonRecord & {
    tracking_id?: string;
    id?: string;
    department?: string;
    currency?: string;
    total?: number | string;
    amount?: number | string;
    status?: string;
    scenario?: string;
    notes?: string;
    note?: string;
    bank_node_available?: boolean;
};
type BudgetDocument = JsonRecord & {
    _etag?: string | null;
    _ttl?: string | number | null;
    value?: { department?: string; amount?: number | string };
};

const daprClient = new DaprClient({ daprHost: DAPR_HOST, daprPort: DAPR_PORT });
const server = new DaprServer({
    serverHost: '0.0.0.0',
    serverPort: APP_PORT,
    clientOptions: { daprHost: DAPR_HOST, daprPort: DAPR_PORT },
});

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isTooManyRequestsError(error: unknown): boolean {
    const raw = errorMessage(error);
    if (raw.includes('Too Many Requests') || raw.includes('"status":429')) return true;
    try {
        const parsed = JSON.parse(raw) as JsonRecord;
        return parsed.status === 429 || parsed.error === 'Too Many Requests';
    } catch {
        return false;
    }
}

async function saveInvoiceWithRetry(trackingId: string, invoiceRecord: JsonRecord): Promise<void> {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= INVOICE_SAVE_MAX_RETRIES; attempt += 1) {
        try {
            await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: invoiceRecord }]);
            return;
        } catch (error) {
            lastError = error;
            if (!isTooManyRequestsError(error) || attempt === INVOICE_SAVE_MAX_RETRIES) break;
            const backoff = INVOICE_SAVE_BASE_DELAY_MS * 2 ** (attempt - 1);
            const jitter = Math.floor(Math.random() * 100);
            console.warn(`[${trackingId}] mongo-invoices write rate-limited (attempt ${attempt}/${INVOICE_SAVE_MAX_RETRIES}). Retrying in ${backoff + jitter}ms`);
            await sleep(backoff + jitter);
        }
    }
    throw lastError;
}

async function resolveFxRateToUSD(currencyCode: string): Promise<number> {
    const normalized = String(currencyCode || 'USD').toUpperCase();
    if (normalized === 'USD') return 1;
    try {
        const raw = await daprClient.state.get('mongo-fx-rates', normalized) as unknown;
        const doc = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) as JsonRecord : null;
        const rate = Number.parseFloat(String(doc?.value?.rate ?? doc?.rate));
        if (!Number.isNaN(rate) && rate > 0) return rate;
    } catch (error) {
        console.warn(`[Payment FX] Failed to load FX rate for ${normalized}:`, errorMessage(error));
    }
    return 1;
}

function parseBudgetAmount(rawBudget: unknown): number | null {
    const parsed = Number.parseFloat(String(rawBudget));
    return Number.isNaN(parsed) || parsed < 0 ? null : parsed;
}

async function resolveDepartmentBudget(departmentId: string): Promise<{ amount: number; budgetDoc: BudgetDocument }> {
    const raw = await daprClient.state.get(BUDGET_STORE, departmentId) as unknown;
    const budgetDoc = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) as BudgetDocument : null;
    const amount = parseBudgetAmount(budgetDoc?.value?.amount ?? budgetDoc?.amount);
    if (amount === null) {
        return { amount: DEFAULT_BUDGET_AMOUNT, budgetDoc: { _id: departmentId, _key: departmentId, value: { department: departmentId, amount: DEFAULT_BUDGET_AMOUNT }, _etag: budgetDoc?._etag || null, _ttl: budgetDoc?._ttl ?? null } };
    }
    return { amount, budgetDoc: { _id: budgetDoc?._id || departmentId, _key: budgetDoc?._key || departmentId, value: { department: budgetDoc?.value?.department || departmentId, amount }, _etag: budgetDoc?._etag || null, _ttl: budgetDoc?._ttl ?? null } };
}

async function persistDepartmentBudget(departmentId: string, amount: number, existingDoc: BudgetDocument): Promise<BudgetDocument> {
    const record: BudgetDocument = { _id: departmentId, _key: departmentId, value: { department: departmentId, amount: Number.parseFloat(String(amount)) }, _etag: existingDoc?._etag || null, _ttl: existingDoc?._ttl ?? null };
    await daprClient.state.save(BUDGET_STORE, [{ key: departmentId, value: record }]);
    return record;
}

async function getStoredInvoice(trackingId: string): Promise<JsonRecord> {
    const raw = await daprClient.state.get('mongo-invoices', trackingId) as unknown;
    return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) as JsonRecord : { tracking_id: trackingId };
}

export async function processInvoicePayment(invoice: Invoice): Promise<PaymentResult> {
    try {
        const trackingId = String(invoice.tracking_id || invoice.id || 'unknown');
        const departmentId = String(invoice.department || 'default-pool');
        const currency = String(invoice.currency || 'USD').toUpperCase();
        const originalAmount = Number.parseFloat(String(invoice.total || invoice.amount || 0));
        console.log(`[${trackingId}] Payment request received`);
        if (!['AUTO_APPROVE', 'APPROVED', 'PROCESSING_PAYMENT'].includes(String(invoice.status))) return 'REJECT';

        const currentScenario = String(invoice.scenario || invoice.notes || invoice.note || '').toLowerCase();
        const isBankOffline = invoice.bank_node_available === false || currentScenario.includes('payment-failure');
        if (isBankOffline) {
            console.log(`[${trackingId}] Detected scenario trigger [${currentScenario}] for ${trackingId}. Executing Saga compensation rollback workflow.`);
            try {
                const storedInvoice = await getStoredInvoice(trackingId);
                storedInvoice.payment = { status: 'REJECTED_ROLLBACK', amount: invoice.total || invoice.amount || 0, currency: invoice.currency || 'USD', reservation: { reserved: false }, failed_at: new Date().toISOString() };
                await saveInvoiceWithRetry(trackingId, storedInvoice);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed.compensate', { tracking_id: trackingId, scenario: currentScenario });
                return 'SUCCESS';
            } catch (error) {
                console.error(`[${trackingId}] Failed to execute transaction saga compensation rollback:`, errorMessage(error));
                return 'RETRY';
            }
        }

        const fxRateToUSD = await resolveFxRateToUSD(currency);
        const amountInUSD = originalAmount * fxRateToUSD;
        if (currency !== 'USD') console.log(`[Payment FX] Evaluated ${originalAmount} ${currency} as $${amountInUSD} USD against department allocation boundaries (rate=${fxRateToUSD}).`);

        let budgetSnapshot: { amount: number; budgetDoc: BudgetDocument };
        try {
            budgetSnapshot = await resolveDepartmentBudget(departmentId);
        } catch (error) {
            console.error(`[${trackingId}] Failed to load budget for [${departmentId}]:`, errorMessage(error));
            return 'RETRY';
        }

        if (budgetSnapshot.amount - amountInUSD < 0) {
            try {
                const storedInvoice = await getStoredInvoice(trackingId);
                storedInvoice.payment = { status: 'FAILED', reason: 'insufficient_budget', department: departmentId, rejected_at: new Date().toISOString() };
                await saveInvoiceWithRetry(trackingId, storedInvoice);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'insufficient_budget', department: departmentId });
                return 'SUCCESS';
            } catch (error) {
                console.error(`[${trackingId}] Failed to persist budget failure state:`, errorMessage(error));
                return 'RETRY';
            }
        }

        const reservation = { reserved: true, amount: originalAmount, currency, created_at: new Date().toISOString() };
        try {
            const storedInvoice = await getStoredInvoice(trackingId);
            storedInvoice.payment = storedInvoice.payment || {};
            storedInvoice.payment.reservation = reservation;
            storedInvoice.status = 'PAID';
            await saveInvoiceWithRetry(trackingId, storedInvoice);
        } catch (error) {
            console.error(`[${trackingId}] Failed to save reservation on invoice record:`, errorMessage(error));
            await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'reservation_failed' });
            return 'RETRY';
        }

        if (currentScenario.includes('payment-failure')) {
            try {
                const storedInvoice = await getStoredInvoice(trackingId);
                storedInvoice.payment = storedInvoice.payment || {};
                storedInvoice.payment.status = 'FAILED';
                storedInvoice.payment.reason = 'simulated_failure';
                delete storedInvoice.payment.reservation;
                storedInvoice.payment.failed_at = new Date().toISOString();
                await saveInvoiceWithRetry(trackingId, storedInvoice);
            } catch (error) {
                console.error(`[${trackingId}] Failed to persist simulated failure:`, errorMessage(error));
            }
            await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'simulated_failure' });
            return 'SUCCESS';
        }

        await persistDepartmentBudget(departmentId, budgetSnapshot.amount - amountInUSD, budgetSnapshot.budgetDoc);
        const paymentRecord = { tracking_id: trackingId, status: 'CONFIRMED', amount: originalAmount, currency, confirmed_at: new Date().toISOString() };
        try {
            const storedInvoice = await getStoredInvoice(trackingId);
            storedInvoice.payment = paymentRecord;
            await saveInvoiceWithRetry(trackingId, storedInvoice);
            await daprClient.pubsub.publish(PUB_SUB, 'payment.confirmed', { tracking_id: trackingId });
            return 'SUCCESS';
        } catch (error) {
            console.error(`[${trackingId}] Failed to persist payment record on invoice:`, errorMessage(error));
            await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'persist_failed' });
            return 'RETRY';
        }
    } catch (error) {
        console.error('Payment handler error:', errorMessage(error));
        return 'RETRY';
    }
}

export async function start(): Promise<void> {
    await server.pubsub.subscribe(PUB_SUB, 'invoice.payment', async (eventData: DaprEvent) => processInvoicePayment('data' in eventData && eventData.data ? eventData.data : eventData));
    await server.start();
    console.log(`Payment Service started on port ${APP_PORT}`);
}

if (process.env.NODE_ENV !== 'test') {
    start().catch((error) => {
        console.error('Failed to start Payment Service:', errorMessage(error));
        process.exit(1);
    });
}

export { daprClient, server };
