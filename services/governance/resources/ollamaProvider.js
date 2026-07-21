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

            const aiResult = JSON.parse(rawContent);


            // Custom override for critical workflow logic constraints

            return {
                recommendation: aiResult.recommendation,
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

    generateSystemPrompt(dynamicPolicyContext) {
        const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.

[ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG)]
<policies>
${dynamicPolicyContext || "No specific policy sections matched the query. Follow general financial guidelines."}
</policies>

STRICT EVALUATION RULES:
1. Category Mapping: Policy rules starting with the prefix "MEAL-" (such as MEAL-01, MEAL-02, MEAL-03) belong directly to the "meals" invoice category. Treat this as a valid category match.
2. Rule MEAL-03 Enforcement: If the invoice payload contains any indicators of alcohol, you MUST immediately add "MEAL-03" to the "triggered_rules" array.

CRITICAL INSTRUCTIONS:
- Evaluate if the invoice violates any of the active policies (check amounts, category constraints, and vendor names).
- If an invoice amount is even $1 higher than a threshold specified in a rule, it is an AUTOMATIC VIOLATION.
- You MUST respond strictly in valid JSON format. Do not write any conversational intro/outro text.
- You have ZERO authority to make assumptions, exceptions, or compromises.
- If ANY rule is violated or triggered, you MUST strictly recommend "HUMAN_REVIEW". "AUTO_APPROVE" is ONLY allowed if there are absolutely zero rule mismatches.
- Use ONLY the exact IDs found in the ACTIVE CORPORATE POLICIES text.

The JSON object MUST follow this exact schema:
{
    "thought_process": "Step-by-step math comparison. Example: 1. Invoice category is 'hardware', which matches Rule HW-02. 2. Total is 1400. 3. Rule HW-02 threshold is 1000. 4. 1400 > 1000 is TRUE, so HW-02 is triggered.",
    "recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW",
    "reason": "Clear English explanation mentioning which specific rule ID or policy segment was evaluated or violated.",
    "confidence": 0.80,// A float between 0 and 1 indicating your confidence in the recommendation.
    "triggered_rules": []// An array of rule IDs that were triggered or violated. If none, return an empty array.
}`;

        return systemPrompt;
    }
}
module.exports = { ollamaProvider };