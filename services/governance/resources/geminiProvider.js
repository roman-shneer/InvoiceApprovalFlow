const { GoogleGenAI, Type } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

class geminiProvider {
    async requestModel(systemPrompt, userPrompt) {
        const modelName = "gemini-2.5-flash";

        try {
            const response = await ai.models.generateContent({
                model: modelName,
                contents: userPrompt,
                config: {
                    systemInstruction: systemPrompt,
                    temperature: 0,
                    responseMimeType: "application/json",
                    responseSchema: {
                        type: "OBJECT",
                        properties: {
                            rules: {
                                type: "ARRAY",
                                items: { type: "STRING" },
                                description: "Array of policy rule IDs violated. If none, MUST be empty array []."
                            },
                            reason: {
                                type: "STRING",
                                description: "Detailed English explanation mentioning which specific rule ID or policy segment was evaluated or violated."
                            },
                            confidence: {
                                type: "NUMBER",
                                description: "Confidence level from 0.0 to 1.0"
                            },
                            recommendation: {
                                type: "STRING",
                                enum: ["AUTO_APPROVE", "HUMAN_REVIEW"],
                                description: "Strictly 'HUMAN_REVIEW' if rules contains any items. 'AUTO_APPROVE' only if empty."
                            }
                        },
                        required: ["rules", "reason", "confidence", "recommendation"],
                    }
                }
            });



            if (!response.text) {
                throw new Error("Gemini returned an empty response.");
            }


            const aiResponse = JSON.parse(response.text);


            return {
                "triggered_rules": Array.isArray(aiResponse.rules) ? aiResponse.rules : [],
                "reason": aiResponse.reason || "Evaluated by Gemini successfully.",
                "confidence": parseFloat(aiResponse.confidence ?? 1.0),
                "recommendation": aiResponse.recommendation || "HUMAN_REVIEW",
                "model": modelName
            };

        } catch (error) {
            console.error("[❌ Gemini API Fatal Error]:", error.message);
            return {
                "triggered_rules": ["API_GEMINI_FALLBACK"],
                "reason": `Gemini API execution failed. Audit forced to manual review. (Details: ${error.message})`,
                "confidence": 0.0,
                "recommendation": "HUMAN_REVIEW",
                "model": modelName
            };
        }
    }

    generateSystemPrompt(dynamicPolicyContext) {
        const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.

[ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG)]
<policies>
    ${dynamicPolicyContext}
</policies>

[STRICT EVALUATION RULES]
1. CASE-INSENSITIVITY: Treat category names as case-insensitive.
2. TRUST THE PAYLOAD: Do not recalculate or validate if (quantity * unitPrice + tax) equals the total. Strictly use the provided "total" field value as the absolute truth for all rule evaluations.
3. ALCOHOL DETECTION: If any line item description contains "Alcohol", "bar tab", "wine", or "beer", trigger Rule MEAL-03.
4. UNKNOWN CATEGORIES: If the invoice contains a category that is NOT explicitly mentioned or mapped in the <policies> block, you MUST treat it as a violation, add "UNKNOWN_CATEGORY" to the "triggered_rules" array, and route it to human review.

[STRICT VERDICT MAPPING]
You must apply this absolute mathematical logic for the final recommendation:
- If "rules" IS EMPTY -> "recommendation" MUST BE "AUTO_APPROVE".
- If "rules" HAS ANY ELEMENTS -> "recommendation" MUST BE "HUMAN_REVIEW".
There are zero exceptions. A non-empty array strictly locks the verdict to "HUMAN_REVIEW".

[JSON SCHEMA]
You MUST respond strictly in a valid JSON object format. Follow this exact sequence of keys:
{
    "rules": ["Array of triggered rule IDs, e.g., ['HW-02']"],
    "reason": "Detailed English explanation mentioning which specific rule ID or policy segment was evaluated or violated.",
    "confidence": 1.0,
    "recommendation": "Either 'AUTO_APPROVE' or 'HUMAN_REVIEW'"
}
`;
        return systemPrompt;

    }

}


module.exports = { geminiProvider };