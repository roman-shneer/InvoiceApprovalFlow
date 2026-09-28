/**
 * Canonical Policy type for governance service
 * Used by: app.ts, ragEngine.ts, applyOverride, evaluateInvoiceWithAI
 */

export type PolicyCategory =
    | 'FRAUD'
    | 'DUPLICATE'
    | 'THRESHOLD'
    | 'VENDOR'
    | 'COMPLIANCE'
    | 'CUSTOM'
    | string;

export type PolicySeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;

export interface Policy {
    id: string;
    name?: string;
    rule_id?: string;
    // Required fields that ragEngine expects - это то что у тебя красное
    rule_text: string;
    category: PolicyCategory;

    // Optional common fields
    description?: string;
    severity?: PolicySeverity;
    condition?: string | Record<string, any>;
    action?: string | Record<string, any>;
    threshold?: number;

    is_active?: boolean;
    created_at?: string;
    updated_at?: string;

    // For RAG embeddings
    embedding?: number[];
    metadata?: Record<string, any>;
}

export default Policy;
