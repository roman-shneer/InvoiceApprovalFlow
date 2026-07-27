const { Ollama } = require('ollama');
const AbstractProvider = require('./abstractProvider');
class ollamaProvider extends AbstractProvider {
    aiEngine = null;
    modelName = process.env.AI_MODEL_NAME || 'llama3';
    constructor() {
        super();
        const API_URL = process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434';
        this.aiEngine = new Ollama({ host: API_URL });;
    }

    async requestModel(trackingId, anonymizedInvoice, policyComplects) {
        const userPrompt = this.generateUserPrompt(anonymizedInvoice);
        const rulesText = policyComplects.join("\n\n");
        const systemPrompt = this.generateSystemPrompt(rulesText);
        return await this.requestOllama(trackingId, systemPrompt, userPrompt)
    }

    async requestOllama(trackingId, systemPrompt, userPrompt) {
        // Construct system prompt embedding the dynamic text segments fetched via the RAG retrieval cursor      
        try {
            const response = await this.aiEngine.chat({
                model: this.modelName,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                options: {
                    temperature: 0.0,
                    top_p: 0.1,
                    num_predict: 1000,    // JSON-answer

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
            let aiResult;
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
                model: this.modelName
            };

        } catch (err) {
            // Safe failover to human queue if JSON parsing or connection fails
            return {
                recommendation: "HUMAN_REVIEW",
                reason: `Local RAG AI Analysis failed or timed out: ${err.message}. Forced routing to manual queue.`,
                confidence: 0,
                triggered_rules: [],
                model: this.modelName
            };
        }
    }

    generateSystemPrompt(dynamicPolicyContext) {

        const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
        Your task is to analyze the user's invoice payload against the active corporate policies below.

        [ACTIVE CORPORATE POLICIES]
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
            "rules": [], // An array of rule IDs that were triggered or violated.
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