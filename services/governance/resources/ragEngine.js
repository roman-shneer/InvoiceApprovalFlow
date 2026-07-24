const { OllamaEmbeddings } = require('@langchain/ollama');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { Document } = require('@langchain/core/documents');
const { getPolicies } = require('./db');

const daprHost = process.env.DAPR_HTTP_HOST || "governance-dapr-sidecar";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

let vectorStore = null;
let globalPolicyContext = [];
function ruleToText(rule) {
    return `Rule ID: ${rule.rule_id}
category: ${rule.category}
Description: ${rule.rule_text}`;
}
async function initRagEngine() {
    try {
        const policies = await getPolicies();
        const sharedRules = policies.filter(rule => ['global rules', 'autonomy'].includes(rule.category.toLowerCase()));
        globalPolicyContext = sharedRules.map(rule => ruleToText(rule));
        const categoryRules = policies.filter(rule => !['global rules', 'autonomy'].includes(rule.category.toLowerCase()));
        const rulesByCategory = [];
        categoryRules.forEach(rule => {
            const categories = rule.category.replace(/\//g, "&").split('&').map(cat => cat.trim().toLowerCase());
            categories.forEach(category => {
                rulesByCategory.push({
                    rule_id: rule.rule_id,
                    category: category,
                    rule_text: rule.rule_text
                });
            });
        });
        const docs = rulesByCategory.map(rule => {
            const fullTextContent = ruleToText(rule);
            return new Document({
                pageContent: fullTextContent,
                metadata: {
                    id: rule.rule_id,
                    category: rule.category
                },
            });
        });
        const ollamaHost = "ollama-service";
        const ollamaPort = "11434";
        const embeddings = new OllamaEmbeddings({
            model: process.env.AI_EMBEDDING_MODEL_NAME || "nomic-embed-text",
            baseUrl: `http://${ollamaHost}:${ollamaPort}`
        });

        vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
        console.log(`✅ [RAG Engine] Successfully indexed ${docs.length} segments with pure JS store.`);
    } catch (err) {
        console.error("❌ [RAG Engine] Initialization failed:", err.message);
        if (err.cause) console.error("🔍 Детали ошибки:", err.cause);
    }
}

async function retrieveRelevantPolicies(invoice) {
    if (!vectorStore) return "";
    try {
        const searchQuery = `Compliance policies, spending thresholds, and limits`;
        const targetCategory = invoice.category?.toLowerCase().trim();
        const results = await vectorStore.similaritySearch(searchQuery, 4, (doc) => doc.metadata.category?.toLowerCase().trim() === targetCategory);
        const resultString = results.map(doc => doc.pageContent).join('\n\n') + "\n\n" + globalPolicyContext.join('\n\n');

        console.log("🔍 [RAG Engine] Retrieved relevant policies for invoice:", resultString);
        return resultString;
    } catch (err) {
        console.error("[RAG Engine] Failed to retrieve policies:", err.message);
        return "";
    }
}

module.exports = { initRagEngine, retrieveRelevantPolicies };
