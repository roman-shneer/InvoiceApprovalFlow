class groqProvider {

    async requestModel(systemPrompt, userPrompt) {
        const modelName = "qwen/qwen3.6-27b";

        try {
            const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
                },
                body: JSON.stringify({
                    model: modelName,
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userPrompt }
                    ],
                    temperature: 0,
                    max_completion_tokens: 2048
                })
            });


            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.error?.message || `HTTP ${response.status} ${response.statusText}`;
                console.error(`[❌ Groq API Error]: status ${response.status}, message: ${errorMessage}`);
                return getFallbackResponse(modelName, `Groq API Error: ${errorMessage}`);
            }

            const data = await response.json();


            if (!data.choices || !data.choices[0] || !data.choices[0].message?.content) {
                console.error("[❌ Groq API Bad Structure]: Response format is invalid", data);
                return this.getFallbackResponse(modelName, "Invalid format structure returned from Groq API.");
            }
            let rawContent = data.choices[0].message.content;


            // 🚀 cleaning <think>...</think>
            if (rawContent.includes("</thinking>")) {
                rawContent = rawContent.split("</thinking>").pop().trim();
            } else if (rawContent.includes("</think>")) {
                rawContent = rawContent.split("</think>").pop().trim();
            }
            rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();
            console.log("[Groq Raw Content]:", rawContent);
            let aiResponse;
            try {
                aiResponse = JSON.parse(rawContent);
            } catch (parseError) {
                console.error("[❌ JSON Parse Error]: Failed to parse model content string", parseError);
                return this.getFallbackResponse(modelName, "Model generated unparsable JSON document.");
            }


            return {
                "triggered_rules": Array.isArray(aiResponse.rules) ? aiResponse.rules : [],
                "reason": aiResponse.reason || "Evaluated by Groq API successfully.",
                "confidence": parseFloat(aiResponse.confidence ?? 1.0),
                "recommendation": aiResponse.recommendation || "HUMAN_REVIEW",
                "model": modelName
            };

        } catch (networkError) {

            console.error("[❌ Groq Network Fatal Error]:", networkError.message);
            return this.getFallbackResponse(modelName, `Network/Fetch fatal failure: ${networkError.message}`);
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

[JSON SCHEMA]
You MUST respond strictly in valid JSON format. Do not wrap the JSON in markdown blocks. Output raw JSON only. 
CRITICAL: The "thought_process" field MUST contain ONLY the rule IDs evaluated. Maximum 5 words. Do not write math explanations.

{
    "thought_process": "Evaluating MEAL-03 and GLOBAL-VENDOR",
    "rules": [],
    "reason": "Short 1-sentence compliance verdict.",
    "confidence": 1.0,
    "recommendation": "Either 'AUTO_APPROVE' or 'HUMAN_REVIEW'"
}

CRITICAL: Start with '{' immediately. Do not write descriptions inside the array.
`;
        return systemPrompt;
    }
}

module.exports = { groqProvider };