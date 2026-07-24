const { Ollama } = require('ollama');

const ollama = new Ollama({ host: 'http://ollama-service:11434' });
class ollamaProvider {

    async requestModel(systemPrompt, userPrompt) {
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
            console.log("ollamaProvider rawContent:", rawContent);
            let aiResult
            try {
                aiResult = JSON.parse(rawContent);
            } catch (parseErr) {
                console.error("ollamaProvider JSON parse error:", parseErr.message);
                aiResult = {
                    recommendation: "HUMAN_REVIEW",
                    reason: `Failed to parse AI model JSON output: ${parseErr.message}. Forced routing to manual queue.`,
                    confidence: 0,
                    triggered_rules: [],
                };
            }
            if (aiResult.analysis) {
                aiResult = aiResult.analysis[0];
            }


            return {
                recommendation: aiResult.recommendation || "HUMAN_REVIEW",
                reason: aiResult.reason || "Evaluated by local RAG-augmented AI engine successfully.",
                confidence: parseFloat(aiResult.confidence || 0),
                triggered_rules: Array.isArray(aiResult.rules) ? aiResult.rules : [],
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

    generateSystemPrompt(dynamicPolicyContext) {

        const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.

[ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG)]
<policies>
${dynamicPolicyContext || "No specific policy sections matched the query. Follow general financial guidelines."}
</policies>
[STRICT VERDICT MAPPING]
- If "rules" is [] -> "recommendation" MUST BE "AUTO_APPROVE"
- If "rules" has items -> "recommendation" MUST BE "HUMAN_REVIEW"

Output ONLY raw JSON. No markdown, no formatting. Keep "reason" under 10 words. 
You are strictly FORBIDDEN from putting objects inside the rules array. It must be a flat array of strings.

Exact template to copy:
{
    "rules": ["RULE-ID"], // An array of rule IDs that were triggered or violated.
    "reason": "Short text.",
    "recommendation": "VERDICT",
    "confidence": 0.8 // A float between 0 and 1 indicating your confidence in the recommendation.
}

CRITICAL: Start with '{' immediately. Do not write descriptions inside the array.
`;

        return systemPrompt;
    }
}
module.exports = { ollamaProvider };