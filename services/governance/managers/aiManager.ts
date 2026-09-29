import { groqProvider } from '../resources/groqProvider';
import { ollamaProvider } from '../resources/ollamaProvider';
import { geminiProvider } from '../resources/geminiProvider';

// ---- INLINE TYPES ----
interface LineItem {
    unitPrice: number;
    quantity: number;
    [key: string]: any;
}

interface Invoice {
    id?: string;
    invoiceNumber?: string;
    submitter?: string;
    notes?: any;
    note?: any;
    audit_metadata?: any;
    scenario?: any;
    expected?: any;
    status?: any;
    idempotency_key?: any;
    submitted_at?: any;
    correlation_id?: any;
    createdAt?: any;
    lineItems?: LineItem[];
    calculatedLineItemsSum?: number;
    taxAmount?: number;
    discrepancy?: number;
    total?: number;
    currency?: string;
    amountInUSD?: number;
    [key: string]: any;
}

interface AiProvider {
    requestModel: (trackingId: string, invoice: any, policies: any[]) => Promise<any>;
}

function anonymizeInvoice(invoice: Invoice | null | undefined, rate: number): Invoice | null | undefined {
    if (!invoice || typeof invoice !== 'object') return invoice as any;

    let cleanInvoice: Invoice = JSON.parse(JSON.stringify(invoice));

    if (cleanInvoice.submitter && typeof cleanInvoice.submitter === 'string') {
        cleanInvoice.submitter = cleanInvoice.submitter.replace(
            /([^@]{1,2})[^@]*([^@]{1,2})@(.*)/,
            (match: string, first: string, last: string, domain: string) => `${first}***${last}@${domain}`
        );
    }

    const maskId = (id: string | undefined): string | undefined =>
        id ? `MASKED-${btoa(String(id)).substring(0, 8)}` : id;

    if (cleanInvoice.id) cleanInvoice.id = maskId(cleanInvoice.id);
    if (cleanInvoice.invoiceNumber) cleanInvoice.invoiceNumber = maskId(cleanInvoice.invoiceNumber);

    const excessFields: (keyof Invoice)[] = [
        'notes',
        'note',
        'audit_metadata',
        'scenario',
        'expected',
        'status',
        'idempotency_key',
        'submitted_at',
        'correlation_id',
        'createdAt'
    ];

    excessFields.forEach(field => {
        if (typeof cleanInvoice[field] !== 'undefined') {
            delete cleanInvoice[field];
        }
    });

    cleanInvoice.calculatedLineItemsSum = cleanInvoice.lineItems?.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0) || 0;
    cleanInvoice.discrepancy = (cleanInvoice.calculatedLineItemsSum || 0) + (cleanInvoice.taxAmount || 0) - (cleanInvoice.total || 0);

    if (cleanInvoice.discrepancy === 0) {
        delete cleanInvoice.discrepancy;
    }

    if (invoice.currency != 'USD') {
        cleanInvoice.amountInUSD = (cleanInvoice.total || 0) * rate;
    }
    return cleanInvoice;
}

async function aiManager(): Promise<AiProvider> {
    if (process.env.GROQ_API_KEY != null && process.env.GROQ_API_KEY.trim() !== "") {
        return new groqProvider() as unknown as AiProvider;
    } else if (process.env.GEMINI_API_KEY != null && process.env.GEMINI_API_KEY.trim() !== "") {
        return new geminiProvider() as unknown as AiProvider;
    } else {
        return new ollamaProvider() as unknown as AiProvider;
    }
}

export { aiManager, anonymizeInvoice };
export type { Invoice, AiProvider };