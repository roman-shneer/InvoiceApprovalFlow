import { OllamaEmbeddings } from '@langchain/ollama';
import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Document } from '@langchain/core/documents';
import { getPolicies } from './db';

const daprHost = process.env.DAPR_HTTP_HOST || "governance-dapr-sidecar";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

// ---- INLINE TYPES ----
import { Policy } from '../types/Policy';

interface NormalizedPolicy {
    rule_id: string;
    category: string;
    rule_text: string;
}

interface Invoice {
    category?: string;
    [key: string]: any;
}

export class RagEngine {
    policies: Policy[] = [];
    embedModel: string = process.env.AI_EMBEDDING_MODEL_NAME || "nomic-embed-text";
    embeddings: OllamaEmbeddings | null = null;
    vectorStore: MemoryVectorStore | null = null;

    constructor() {
        this.policies = [];
        this.embeddings = new OllamaEmbeddings({
            model: this.embedModel,
            baseUrl: process.env.OLLAMA_API_URL
        } as any);
    }

    ruleToText(rule: NormalizedPolicy): string {
        return `Rule ID: ${rule.rule_id}` + "\n"
            + `Description: ${rule.rule_text}`;
    }

    comparePolicies(policies: Policy[]): boolean {
        return JSON.stringify(this.policies) === JSON.stringify(policies);
    }

    async init(policies: Policy[]): Promise<void> {
        try {
            const rulesByCategory: NormalizedPolicy[] = [];
            policies.forEach(rule => {
                const categories = rule.category.replace(/\//g, "&").split('&');
                categories.forEach(category => {
                    category = category.trim().toLowerCase();
                    rulesByCategory.push({
                        rule_id: rule.rule_id,
                        category: category,
                        rule_text: rule.rule_text
                    });
                });
            });

            const docs = rulesByCategory.map(rule => {
                return new Document({
                    pageContent: this.ruleToText(rule),
                    metadata: {
                        id: rule.rule_id,
                        category: rule.category,
                    },
                });
            });

            this.vectorStore = await MemoryVectorStore.fromDocuments(docs, this.embeddings as any);
            console.log(`✅ [RAG Engine] Successfully indexed ${docs.length} segments with pure JS store.`);
        } catch (err: any) {
            console.error("❌ [RAG Engine] Initialization failed:", err.message);
            if (err.cause) console.error("🔍 Error:", err.cause);
        }
    }

    async retrieveRelevantPolicies(invoice: Invoice, activeRules: Policy[]): Promise<string[]> {
        if (this.policies.length === 0 || !this.comparePolicies(activeRules)) {
            await this.init(activeRules);
            this.policies = activeRules;
        }

        if (!this.vectorStore) return [];

        try {
            const searchQuery = `Compliance policies, spending thresholds, and limits`;
            const targetCategory = invoice.category?.toLowerCase().trim();

            const results = await this.vectorStore.similaritySearch(searchQuery, 10, (doc: any) => {
                const category = doc.metadata.category?.toLowerCase().trim();
                return ([targetCategory, 'global rules', 'autonomy'].includes(category));
            });
            return results.map(doc => doc.pageContent);
        } catch (err: any) {
            console.error("[RAG Engine] Failed to retrieve policies:", err.message);
            return [];
        }
    }
}

export type { Policy, Invoice };