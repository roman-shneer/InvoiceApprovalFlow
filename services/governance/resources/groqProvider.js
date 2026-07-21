async function groqProvider(systemPrompt, userPrompt) {
    const modelName = (process.env.GROQ_MODEL_NAME && process.env.GROQ_MODEL_NAME.trim() !== "") ? process.env.GROQ_MODEL_NAME : "qwen/qwen3.6-27b";

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
            return getFallbackResponse(modelName, "Invalid format structure returned from Groq API.");
        }
        let rawContent = data.choices[0].message.content;


        // 🚀 cleaning <think>...</think>
        if (rawContent.includes("</thinking>")) {
            rawContent = rawContent.split("</thinking>").pop().trim();
        } else if (rawContent.includes("</think>")) {
            rawContent = rawContent.split("</think>").pop().trim();
        }
        rawContent = rawContent.replace(/```json/g, "").replace(/```/g, "").trim();

        let aiResponse;
        try {
            aiResponse = JSON.parse(rawContent);
        } catch (parseError) {
            console.error("[❌ JSON Parse Error]: Failed to parse model content string", parseError);
            return getFallbackResponse(modelName, "Model generated unparsable JSON document.");
        }


        return {
            "triggered_rules": Array.isArray(aiResponse.triggered_rules) ? aiResponse.triggered_rules : [],
            "reason": aiResponse.reason || "Evaluated by Groq API successfully.",
            "aiReason": aiResponse.reason || "Evaluated by Groq API successfully.",
            "confidence": parseFloat(aiResponse.confidence ?? 1.0),
            "recommendation": aiResponse.recommendation || "HUMAN_REVIEW",
            "aiRecommendation": aiResponse.recommendation || "HUMAN_REVIEW",
            "model": modelName
        };

    } catch (networkError) {

        console.error("[❌ Groq Network Fatal Error]:", networkError.message);
        return getFallbackResponse(modelName, `Network/Fetch fatal failure: ${networkError.message}`);
    }
}


function getFallbackResponse(modelName, internalReason) {
    return {
        "triggered_rules": ["API_COMPLIANCE_FALLBACK"],
        "reason": `System safety fallback triggered. Audit forced to manual review. (Details: ${internalReason})`,
        "aiReason": `System safety fallback triggered. Audit forced to manual review. (Details: ${internalReason})`,
        "confidence": 0.0,
        "recommendation": "HUMAN_REVIEW",
        "aiRecommendation": "HUMAN_REVIEW",
        "model": modelName
    };
}


module.exports = { groqProvider };