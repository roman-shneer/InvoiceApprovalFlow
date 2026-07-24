const Groq = require("groq-sdk");
const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});
class groqProvider {

    async requestModel(systemPrompt, userPrompt) {
        //const modelName = "qwen/qwen3.6-27b";    
        const modelName = "openai/gpt-oss-120b";

        try {
            const completion = await groq.chat.completions.create({
                model: modelName,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt }
                ],
                temperature: 0,
                max_completion_tokens: 1024,
            });
            console.log("groqProvider completion:", completion);
            const rawContent = completion.choices[0]?.message?.content;

            if (!rawContent) {
                throw new Error("Empty response from Groq SDK");
            }
            console.log("groqProvider rawContent:", rawContent);

            const aiResponse = JSON.parse(rawContent);

            return {
                "triggered_rules": aiResponse.rules,
                "reason": aiResponse.reason,
                "confidence": aiResponse.confidence,
                "recommendation": aiResponse.recommendation,
                "model": modelName
            };

        } catch (error) {
            console.error("[❌ Groq SDK Error]:", error.message);
            return {
                "triggered_rules": ["API_GROQ_SDK_FALLBACK"],
                "reason": `Groq SDK execution failed: ${error.message}`,
                "confidence": 0.0,
                "recommendation": "HUMAN_REVIEW",
                "model": modelName
            };
        }
    }


    getFallbackResponse(modelName, internalReason) {
        return {
            "rules": ["API_COMPLIANCE_FALLBACK"],
            "reason": `System safety fallback triggered. Audit forced to manual review. (Details: ${internalReason})`,
            "confidence": 0.0,
            "recommendation": "HUMAN_REVIEW",
            "model": modelName
        };
    }

    generateSystemPrompt(dynamicPolicyContext) {
        const systemPrompt = `You are an expert corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the following corporate policies extracted dynamically from the company's official handbook.

[ACTIVE CORPORATE POLICIES (RETRIEVED VIA RAG)]
<policies>
${dynamicPolicyContext || "No specific policy sections matched the query. Follow general financial guidelines."}
</policies>

[STRICT EVALUATION RULES]
1. CASE-INSENSITIVITY: Treat category names as case-insensitive.
2. TRUST THE PAYLOAD: Do not recalculate or validate if (quantity * unitPrice + tax) equals the total. Strictly use the provided "total" field value as the absolute truth for all rule evaluations.
3. ALCOHOL DETECTION: If any line item description contains "Alcohol", "bar tab", "wine", or "beer", trigger Rule MEAL-03.
4. UNKNOWN CATEGORIES: If the invoice contains a category that is NOT explicitly mentioned or mapped in the <policies> block, you MUST treat it as a violation, add "UNKNOWN_CATEGORY" to the "rules" array, and route it to human review.

[STRICT VERDICT MAPPING]
You must apply this absolute mathematical logic for the final recommendation:
- If "rules" IS EMPTY -> "recommendation" MUST BE "AUTO_APPROVE".
- If "rules" HAS ANY ELEMENTS -> "recommendation" MUST BE "HUMAN_REVIEW".
There are zero exceptions. A non-empty array strictly locks the verdict to "HUMAN_REVIEW".

[OUTPUT INSTRUCTION]
Return ONLY a valid JSON object. Do not wrap the output in markdown blocks (no \\\`\\\`\\\`json). Keep the "reason" field brief and under 10 words. 
The object structure must be exactly:
{"rules": [], "reason": "", "confidence": 1.0, "recommendation": ""}
`;
        return systemPrompt;
    }
}

module.exports = { groqProvider };