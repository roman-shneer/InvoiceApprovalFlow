const { Ollama } = require('ollama');

const ollama = new Ollama({ host: 'http://ollama-service:11434' });

async function ollamaProvider(systemPrompt, userPrompt) {
    // Construct system prompt embedding the dynamic text segments fetched via the RAG retrieval cursor      
    try {
        const response = await ollama.chat({
            model: process.env.AI_MODEL_NAME || 'llama3',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            options: {
                temperature: 0.1,
                top_p: 0.1,
                num_predict: 250,    // JSON-answer

                num_ctx: 512, //memory buffer
                num_thread: 4,//cpu count
            },
            format: 'json'
        });

        let rawContent = response.message.content.trim();

        // Defensive regex to strip markdown block ticks if Llama 3 hallucinates them
        if (rawContent.startsWith("```")) {
            rawContent = rawContent.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
        }

        const aiResult = JSON.parse(rawContent);


        // Custom override for critical workflow logic constraints

        return {
            aiRecommendation: aiResult.recommendation,
            recommendation: aiResult.recommendation,
            aiReason: aiResult.reason || "Evaluated by local RAG-augmented AI engine successfully.",
            reason: aiResult.reason || "Evaluated by local RAG-augmented AI engine successfully.",
            confidence: parseFloat(aiResult.confidence || 0),
            triggered_rules: Array.isArray(aiResult.triggered_rules) ? aiResult.triggered_rules : [],
            model: process.env.AI_MODEL_NAME || 'llama3'
        };

    } catch (err) {
        // Safe failover to human queue if JSON parsing or connection fails
        return {
            recommendation: "HUMAN_REVIEW",
            reason: `Local RAG AI Analysis failed or timed out: ${err.message}. Forced routing to manual queue.`,
            confidence: 0,
            triggered_rules: [],
            model: process.env.AI_MODEL_NAME || 'llama3'
        };
    }
}
module.exports = { ollamaProvider };