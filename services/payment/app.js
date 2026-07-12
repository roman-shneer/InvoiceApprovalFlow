const { DaprServer, DaprClient } = require('@dapr/dapr');

const APP_PORT = process.env.APP_PORT || '8010';
const DAPR_HOST = process.env.DAPR_HOST || '127.0.0.1';
const DAPR_PORT = process.env.DAPR_HTTP_PORT || '3500';
const PUB_SUB = 'approval-pubsub';
const BUDGET_STORE = 'mongo-budgets';
const DEFAULT_BUDGET_AMOUNT = 5000;
const INVOICE_SAVE_MAX_RETRIES = parseInt(process.env.INVOICE_SAVE_MAX_RETRIES || '5', 10);
const INVOICE_SAVE_BASE_DELAY_MS = parseInt(process.env.INVOICE_SAVE_BASE_DELAY_MS || '150', 10);

const daprClient = new DaprClient({ daprHost: DAPR_HOST, daprPort: DAPR_PORT });

const server = new DaprServer({
    serverHost: '0.0.0.0',
    serverPort: APP_PORT,
    clientOptions: {
        daprHost: DAPR_HOST,
        daprPort: DAPR_PORT
    }
});

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTooManyRequestsError(err) {
    const raw = String(err?.message || err || '');
    if (raw.includes('Too Many Requests') || raw.includes('"status":429')) {
        return true;
    }

    try {
        const parsed = JSON.parse(raw);
        return parsed?.status === 429 || parsed?.error === 'Too Many Requests';
    } catch (_) {
        return false;
    }
}

async function saveInvoiceWithRetry(trackingId, invoiceRecord) {
    let lastError = null;

    for (let attempt = 1; attempt <= INVOICE_SAVE_MAX_RETRIES; attempt++) {
        try {
            await daprClient.state.save('mongo-invoices', [{ key: trackingId, value: invoiceRecord }]);
            return;
        } catch (err) {
            lastError = err;
            if (!isTooManyRequestsError(err) || attempt === INVOICE_SAVE_MAX_RETRIES) {
                break;
            }

            const backoff = INVOICE_SAVE_BASE_DELAY_MS * Math.pow(2, attempt - 1);
            const jitter = Math.floor(Math.random() * 100);
            console.warn(`[${trackingId}] mongo-invoices write rate-limited (attempt ${attempt}/${INVOICE_SAVE_MAX_RETRIES}). Retrying in ${backoff + jitter}ms`);
            await sleep(backoff + jitter);
        }
    }

    throw lastError;
}

async function resolveFxRateToUSD(currencyCode) {
    const normalized = String(currencyCode || 'USD').toUpperCase();
    if (normalized === 'USD') {
        return 1;
    }

    try {
        const raw = await daprClient.state.get('mongo-fx-rates', normalized);
        const doc = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
        const rate = parseFloat(doc?.value?.rate ?? doc?.rate);
        if (!Number.isNaN(rate) && rate > 0) {
            return rate;
        }
    } catch (err) {
        console.warn(`[Payment FX] Failed to load FX rate for ${normalized}:`, err.message);
    }

    // Fallback for operational continuity when FX document is missing or malformed.
    return 1;
}

function parseBudgetAmount(rawBudget) {
    const parsed = parseFloat(rawBudget);
    if (Number.isNaN(parsed) || parsed < 0) {
        return null;
    }
    return parsed;
}

async function resolveDepartmentBudget(departmentId) {
    const raw = await daprClient.state.get(BUDGET_STORE, departmentId);
    const budgetDoc = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null;
    const amount = parseBudgetAmount(budgetDoc?.value?.amount ?? budgetDoc?.amount);

    if (amount === null) {
        return {
            amount: DEFAULT_BUDGET_AMOUNT,
            budgetDoc: {
                _id: departmentId,
                _key: departmentId,
                value: { department: departmentId, amount: DEFAULT_BUDGET_AMOUNT },
                _etag: budgetDoc?._etag || null,
                _ttl: budgetDoc?._ttl ?? null
            }
        };
    }

    return {
        amount,
        budgetDoc: {
            _id: budgetDoc?._id || departmentId,
            _key: budgetDoc?._key || departmentId,
            value: {
                department: budgetDoc?.value?.department || departmentId,
                amount
            },
            _etag: budgetDoc?._etag || null,
            _ttl: budgetDoc?._ttl ?? null
        }
    };
}

async function persistDepartmentBudget(departmentId, amount, existingDoc) {
    const nextAmount = parseFloat(amount);
    const record = {
        _id: departmentId,
        _key: departmentId,
        value: {
            department: departmentId,
            amount: nextAmount
        },
        _etag: existingDoc?._etag || null,
        _ttl: existingDoc?._ttl ?? null
    };

    await daprClient.state.save(BUDGET_STORE, [{ key: departmentId, value: record }]);
    return record;
}


async function processInvoicePayment(invoice) {
    try {
        const trackingId = invoice.tracking_id || invoice.id || 'unknown';
        const departmentId = invoice.department || 'default-pool';
        const currency = (invoice.currency || 'USD').toUpperCase();
        const originalAmount = parseFloat(invoice.total || invoice.amount || 0);
        console.log(`[${trackingId}] Payment request received`);

        if (invoice.status !== 'AUTO_APPROVE' && invoice.status !== 'APPROVED') {
            return 'REJECT';
        }

        const currentScenario = String(invoice.scenario || invoice.notes || invoice.note || '').toLowerCase();
        const isBankOffline = invoice.bank_node_available === false ||
            currentScenario.includes('payment-failure');

        if (isBankOffline) {
            console.log(`[${trackingId}] Detected scenario trigger [${currentScenario}] for ${trackingId}. Executing Saga compensation rollback workflow.`);
            try {
                let stored = await daprClient.state.get('mongo-invoices', trackingId);
                let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

                storedInvoice.payment = {
                    status: 'REJECTED_ROLLBACK',
                    amount: invoice.total || invoice.amount || 0,
                    currency: invoice.currency || 'USD',
                    reservation: { reserved: false },
                    failed_at: new Date().toISOString()
                };

                await saveInvoiceWithRetry(trackingId, storedInvoice);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed.compensate', { tracking_id: trackingId, scenario: currentScenario });
                return 'SUCCESS';
            } catch (err) {
                console.error(`[${trackingId}] Failed to execute transaction saga compensation rollback:`, err.message);
                return 'RETRY';
            }
        }

        const fxRateToUSD = await resolveFxRateToUSD(currency);
        let amountInUSD = originalAmount * fxRateToUSD;
        if (currency !== 'USD') {
            console.log(`[Payment FX] Evaluated ${originalAmount} ${currency} as $${amountInUSD} USD against department allocation boundaries (rate=${fxRateToUSD}).`);
        }

        let budgetSnapshot;
        try {
            budgetSnapshot = await resolveDepartmentBudget(departmentId);
        } catch (err) {
            console.error(`[${trackingId}] Failed to load budget for [${departmentId}]:`, err.message);
            return 'RETRY';
        }

        const currentRemainingBudget = budgetSnapshot.amount;

        if (currentRemainingBudget - amountInUSD < 0) {
            console.error(`[${trackingId}] Saga Terminated: Insufficient Budget Pool. Remaining: $${currentRemainingBudget}, Required in USD: $${amountInUSD}`);
            try {
                let stored = await daprClient.state.get('mongo-invoices', trackingId);
                let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

                storedInvoice.payment = {
                    status: 'FAILED',
                    reason: 'insufficient_budget',
                    department: departmentId,
                    rejected_at: new Date().toISOString()
                };

                await saveInvoiceWithRetry(trackingId, storedInvoice);
                await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'insufficient_budget', department: departmentId });
                return 'SUCCESS';
            } catch (err) {
                console.error(`[${trackingId}] Failed to persist concurrency batch budget failure state:`, err.message);
                return 'RETRY';
            }
        }

        const reservation = {
            reserved: true,
            amount: originalAmount,
            currency: currency,
            created_at: new Date().toISOString()
        };

        try {
            let stored = await daprClient.state.get('mongo-invoices', trackingId);
            let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };

            storedInvoice.payment = storedInvoice.payment || {};
            storedInvoice.payment.reservation = reservation;

            await saveInvoiceWithRetry(trackingId, storedInvoice);
        } catch (err) {
            console.error(`[${trackingId}] Failed to save reservation on invoice record:`, err.message);
            await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'reservation_failed' });
            return 'RETRY';
        }

        if (currentScenario.includes('payment-failure')) {
            console.log(`[${trackingId}] Simulating payment failure for scenario ${currentScenario}`);
            try {
                let stored = await daprClient.state.get('mongo-invoices', trackingId);
                let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };
                storedInvoice.payment = storedInvoice.payment || {};
                storedInvoice.payment.status = 'FAILED';
                storedInvoice.payment.reason = 'simulated_failure';
                delete storedInvoice.payment.reservation;
                storedInvoice.payment.failed_at = new Date().toISOString();
                await saveInvoiceWithRetry(trackingId, storedInvoice);
            } catch (err) {
                console.error(`[${trackingId}] Failed to persist simulated failure:`, err.message);
            }
            await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'simulated_failure' });
            return 'SUCCESS';
        }

        const nextRemainingBudget = currentRemainingBudget - amountInUSD;
        try {
            await persistDepartmentBudget(departmentId, nextRemainingBudget, budgetSnapshot.budgetDoc);
        } catch (err) {
            console.error(`[${trackingId}] Failed to persist budget deduction for [${departmentId}]:`, err.message);
            return 'RETRY';
        }

        console.log(`[${trackingId}] Budget pool allocated successfully for [${departmentId}]. Remaining balance left: $${nextRemainingBudget}`);

        const paymentRecord = {
            tracking_id: trackingId,
            status: 'CONFIRMED',
            amount: originalAmount,
            currency: currency,
            confirmed_at: new Date().toISOString()
        };

        try {
            let stored = await daprClient.state.get('mongo-invoices', trackingId);
            let storedInvoice = stored ? (typeof stored === 'string' ? JSON.parse(stored) : stored) : { tracking_id: trackingId };
            storedInvoice.payment = paymentRecord;
            storedInvoice.payment.confirmed_at = paymentRecord.confirmed_at;
            await saveInvoiceWithRetry(trackingId, storedInvoice);

            await daprClient.pubsub.publish(PUB_SUB, 'payment.confirmed', { tracking_id: trackingId });
            console.log(`[${trackingId}] Payment confirmed and published`);
        } catch (err) {
            console.error(`[${trackingId}] Failed to persist payment record on invoice:`, err.message);
            await daprClient.pubsub.publish(PUB_SUB, 'payment.failed', { tracking_id: trackingId, reason: 'persist_failed' });
            return 'RETRY';
        }

        return 'SUCCESS';
    } catch (err) {
        console.error('Payment handler error:', err.message);
        return 'RETRY';
    }
}
//search once on starup for stuck invoices and process them
async function processUnpaidInvoices() {
    const response = await daprClient.state.query("mongo-invoices", {
        filter: {
            OR: [
                {
                    EQ: {
                        status: 'AUTO_APPROVE'
                    }
                },
                {
                    EQ: {
                        status: 'APPROVED'
                    }
                }
            ]
        },
        page: { limit: 1000 },
        sort: [
            {
                key: 'created_at',
                order: 'ASC'
            }
        ]
    });

    console.log(`Found ${response.results.length} unpaid invoices to process`);

    const invoices = response.results.map(item => {
        return item.data || item.value;
    });
    for (const invoice of invoices) {
        await processInvoicePayment(invoice);

    }
}

async function start() {
    await server.pubsub.subscribe(PUB_SUB, 'payment.requested', async (eventData) => {
        return await processInvoicePayment(eventData.data || eventData);
    });

    await server.start();
    await processUnpaidInvoices();
    console.log(`🚀 Payment Service started on port ${APP_PORT}`);
}

start().catch((e) => {
    console.error('Failed to start Payment Service:', e.message);
    process.exit(1);
});
