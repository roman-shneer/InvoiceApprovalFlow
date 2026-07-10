

const { DaprClient } = require('@dapr/dapr');
const daprHost = "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

const client = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
});


async function getPendingInvoices(status = 'PENDING', limit = 1) {
    const response = await client.state.query("mongo-invoices", {
        filter: {
            EQ: {
                status: status
            }
        },
        page: { limit: limit },
        sort: [
            {
                key: 'created_at',
                order: 'ASC'
            }
        ]
    });

    const invoices = response.results.map(item => {
        return item.data || item.value;
    });
    return invoices;
}


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

async function getFxRates() {
    const response = await client.state.query("mongo-fx-rates", {
        filter: {},
        page: { limit: 200 }
    });

    const rates = {};
    for (const item of response?.results || []) {
        const doc = item.data || item.value || {};
        const code = String(doc._id || doc._key || item.key || '').toUpperCase();
        const rate = parseFloat(doc.value?.rate ?? doc.rate);

        if (code && !Number.isNaN(rate) && rate > 0) {
            rates[code] = rate;
        }
    }

    if (!rates.USD) {
        rates.USD = 1;
    }

    return rates;
}


async function saveInvoiceToMongo(invoice) {

    const pendingInvoice = {
        ...invoice,
        createdAt: new Date().toISOString()
    };
    try {
        await client.state.save("mongo-invoices", [
            {
                key: invoice.tracking_id,
                value: pendingInvoice
            }
        ]);

    } catch (dbErr) {
        console.log(`[${invoice.tracking_id}] ERROR: ${invoice.correlation_id}: Failed to save audit record in MongoDB: ${dbErr.message}`);
    }
}

module.exports = { getPolicies, getFxRates, saveInvoiceToMongo, getPendingInvoices };