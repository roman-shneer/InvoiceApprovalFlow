export type InvoiceStatus = 'PROCESSING' | 'APPROVED' | 'REJECTED' | 'HUMAN_REVIEW' | string;

export interface AuditMetadata {
    checked_at: string;
    reason: string;
    triggered_rules: string[];
    confidence: number;
    recommendation: InvoiceStatus;
    [key: string]: any;
}

export interface Invoice {
    trackingId?: string;
    tracking_id?: string;
    id?: string;
    total: number; // всегда number
    amount?: number;
    currency?: string;
    vendor?: string;
    vendor_id?: string;
    invoice_number?: string;
    status: InvoiceStatus;
    audit_metadata?: AuditMetadata;
    lockedBy?: string;
    [key: string]: any;
}

export function normalizeInvoice(invoice: any): Invoice {
    const total = typeof invoice.total === 'string' ? parseFloat(invoice.total) : invoice.total;
    return { ...invoice, total: isNaN(total) ? 0 : total } as Invoice;
}
