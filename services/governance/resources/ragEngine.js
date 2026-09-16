const { OllamaEmbeddings } = require('@langchain/ollama');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { Document } = require('@langchain/core/documents');
const { getPolicies } = require('./db');

const daprHost = process.env.DAPR_HTTP_HOST || "governance-dapr-sidecar";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

class RagEngine {
    policies = [];
    embedModel = process.env.AI_EMBEDDING_MODEL_NAME || "nomic-embed-text";
    embeddings = null;
    vectorStore = null;
    constructor() {

        this.policies = [];
        this.embeddings = new OllamaEmbeddings({
            model: this.embedModel,
            baseUrl: process.env.OLLAMA_API_URL
        });

    }

    ruleToText(rule) {
        return `Rule ID: ${rule.rule_id}` + "\n"
            + `Description: ${rule.rule_text}`;
    }


    comparePolicies(policies) {
        return JSON.stringify(this.policies) === JSON.stringify(policies);
    }

    async init(policies) {
        try {
            const rulesByCategory = [];
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

            this.vectorStore = await MemoryVectorStore.fromDocuments(docs, this.embeddings);
            console.log(`✅ [RAG Engine] Successfully indexed ${docs.length} segments with pure JS store.`);
        } catch (err) {
            console.error("❌ [RAG Engine] Initialization failed:", err.message);
            if (err.cause) console.error("🔍 Error:", err.cause);
        }
    }

    async retrieveRelevantPolicies(invoice, activeRules) {
        if (this.policies.length === 0 || !this.comparePolicies(activeRules)) {
            await this.init(activeRules);
            this.policies = activeRules; // Update the policies after initialization
        }

        if (!this.vectorStore) return "";

        try {
            const searchQuery = `Compliance policies, spending thresholds, and limits`;
            const targetCategory = invoice.category?.toLowerCase().trim();

            const results = await this.vectorStore.similaritySearch(searchQuery, 10, (doc) => {
                const category = doc.metadata.category?.toLowerCase().trim();
                return ([targetCategory, 'global rules', 'autonomy'].includes(category));
            });
            return results.map(doc => doc.pageContent);
        } catch (err) {
            console.error("[RAG Engine] Failed to retrieve policies:", err.message);
            return [];
        }
    }
}

module.exports = { RagEngine };
