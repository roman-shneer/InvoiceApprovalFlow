const fs = require('fs/promises');
const path = require('path');
const { OllamaEmbeddings } = require('@langchain/ollama');
const { MemoryVectorStore } = require('langchain/vectorstores/memory');
const { Document } = require('@langchain/core/documents');


const daprHost = process.env.DAPR_HTTP_HOST || "governance-dapr-sidecar";
const daprPort = process.env.DAPR_HTTP_PORT || "3500";

let vectorStore = null;

async function initRagEngine() {
    try {
        console.log("🤖 [RAG Engine] Initializing pure JS memory vector store over policy...");
        const filePath = path.join(__dirname, '..', 'docs', 'policy.md');
        const text = await fs.readFile(filePath, 'utf8');
        const chunks = text.split('\n\n').map(c => c.trim()).filter(Boolean);

        const docs = chunks.map((chunk, index) => new Document({
            pageContent: chunk,
            metadata: { id: index }
        }));

        const ollamaHost = "ollama-service";
        const ollamaPort = "11434";
        const embeddings = new OllamaEmbeddings({
            model: "nomic-embed-text",
            baseUrl: `http://${ollamaHost}:${ollamaPort}`
        });

        vectorStore = await MemoryVectorStore.fromDocuments(docs, embeddings);
        console.log(`✅ [RAG Engine] Successfully indexed ${chunks.length} segments with pure JS store.`);
    } catch (err) {
        console.error("❌ [RAG Engine] Initialization failed:", err.message);
        if (err.cause) console.error("🔍 Детали ошибки:", err.cause);
    }
}

async function retrieveRelevantPolicies(invoice) {
    if (!vectorStore) return "";
    try {
        const searchQuery = `Invoice check: category ${invoice.category}, vendor ${invoice.vendor}, total amount ${invoice.total}`;
        const results = await vectorStore.similaritySearch(searchQuery, 4);
        return results.map(doc => doc.pageContent).join('\n\n');
    } catch (err) {
        console.error("[RAG Engine] Failed to retrieve policies:", err.message);
        return "";
    }
}

module.exports = { initRagEngine, retrieveRelevantPolicies };
