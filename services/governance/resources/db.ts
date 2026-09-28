import { DaprClient } from '@dapr/dapr';

const daprHost = process.env.DAPR_HTTP_HOST || "127.0.0.1";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

const client = new DaprClient({
    daprHost: daprHost,
    daprPort: daprPort,
    communicationTimeoutMs: 300000
} as any);

// ---- INLINE TYPES ----


import { Policy } from './../types/Policy';
import { Invoice } from './../types/Invoice';

interface FxRateDoc {
    _id?: string;
    _key?: string;
    key?: string;
    value?: { rate?: string | number };
    rate?: string | number;
}

interface StateQueryResult {
    results?: Array<{
        key?: string;
        data?: any;
        value?: any;
    }>;
}

type QueryFilter = any;

async function getPendingInvoices(
    status: string = 'PENDING',
    limit: number = 1,
    timeAgoMs: number | null = null
): Promise<Invoice[]> {
    const rules: QueryFilter[] = [{ EQ: { status } }];

    if (timeAgoMs) {
        rules.push({
            GTE: { processing_date: timeAgoMs }
        });
    }

    const response = await (client as any).state.query("mongo-invoices", {
        filter: rules.length > 1 ? { AND: rules } : rules[0],
        page: { limit },
        sort: [{ key: 'created_at', order: 'ASC' }]
    }) as StateQueryResult;

    return (response?.results || []).map(item => item.data || item.value || item) as Invoice[];
}

async function getPolicies(): Promise<Policy[]> {
    const response = await (client as any).state.query("mongo-policies", {
        filter: { EQ: { "is_active": true } },
        page: { limit: 100 }
    }) as StateQueryResult;

    const activeRules = response.results!.map(item => {
        return item.data || item.value;
    });
    return activeRules as Policy[];
}

async function getFxRate(currency: string, date: string): Promise<any> {
    const rateKey = `${currency}_${date}`;
    return await (client as any).state.get("mongo-fx-rates", rateKey);
}

async function getFxRates(): Promise<Record<string, number>> {
    const response = await (client as any).state.query("mongo-fx-rates", {
        filter: {},
        page: { limit: 200 }
    }) as StateQueryResult;

    const rates: Record<string, number> = {};
    for (const item of response?.results || []) {
        const doc = (item.data || item.value || {}) as FxRateDoc;
        const code = String(doc._id || doc._key || (item as any).key || '').toUpperCase();
        const rate = parseFloat((doc.value?.rate ?? doc.rate) as any);

        if (code && !Number.isNaN(rate) && rate > 0) {
            rates[code] = rate;
        }
    }

    if (!rates.USD) {
        rates.USD = 1;
    }

    return rates;
}

async function saveInvoiceToMongo(invoice: Invoice): Promise<void> {
    const pendingInvoice: Invoice = {
        ...invoice,
        createdAt: new Date().toISOString()
    };
    try {
        await (client as any).state.save("mongo-invoices", [
            {
                key: invoice.tracking_id,
                value: pendingInvoice
            }
        ]);
    } catch (dbErr: any) {
        console.log(`[${invoice.tracking_id}] ERROR: ${invoice.correlation_id}: Failed to save audit record in MongoDB: ${dbErr.message}`);
    }
}

export { getPolicies, getFxRates, saveInvoiceToMongo, getPendingInvoices, getFxRate, client as daprDbClient };
export type { Invoice, Policy };