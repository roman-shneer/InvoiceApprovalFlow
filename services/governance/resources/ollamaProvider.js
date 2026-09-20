const { Ollama } = require('ollama');
class ollamaProvider {
    aiEngine = null;
    modelName = process.env.AI_MODEL_NAME || 'llama3';
    constructor() {
        const API_URL = process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434';
        console.log(`[ollamaProvider] Using Ollama API URL: ${API_URL}`);
        this.aiEngine = new Ollama({ host: API_URL });;
    }

    async requestModel(trackingId, invoice, policyComplects) {

        const d = new Date(invoice.date);
        const weekDate = d.toLocaleDateString('en-US', { weekday: 'long' });

        const prompt1 = `You are extractor.
        Step 1. Calculate per_persone = total / attendees
        Step 2. if Items contains name or organization, set client_name_present = true, else false and extract client_name if present
        Step 3. If Items contains only alcohol keywords, set is_alcohol_only = true, else false
        Step 4. Calculate total_items_sum = Items sum of unitPrice * quantity for all line items
        Step 5. If Items contains First Class or Business Class, set class = "first" or "business", else "economy"
        Step6.  It Items contains monthly subscription, set monthly_subscription = true, else false
        Output ONLY raw JSON.No markdown, no formatting.
            Output:
        {
            "per_person": 1,
            "client_name":"alex",
            "client_name_present": false,
            "is_alcohol_only": false,
            "total_items_sum": 0,
            "class": "economy" // or "business" or "first" for travel category,
            "monthly_subscription": false // true if any line item is a monthly subscription for saas category
        }

        Invoice to check:
        - ReceiptPresent: ${invoice.receiptPresent ? "true" : "false"}        
        - Date: ${invoice.date} (${weekDate == "Saturday" || weekDate == "Sunday" ? "weekend" : "weekday"}) 
        - Total: ${invoice.total} 
        - TaxAmount: ${invoice.taxAmount || 0}
        - Attendees: ${invoice.attendees || 0}
        - Items: ${invoice.lineItems.map(item => `${item.description} - ${item.unitPrice} x ${item.quantity}`).join(", ")} 
        `;
        console.log(`Prompt1: ${prompt1}`);
        console.log(`-----------------------------------------------------`);
        const t1 = Date.now();
        const response1 = await this.requestOllama(trackingId, prompt1, this.modelName);
        console.log(`[${trackingId}](${this.modelName})[${Date.now() - t1}ms] First Response: `, response1);
        console.log(`-----------------------------------------------------`);
        //second request
        let variables = {
            'per_person': response1.per_person,
            'totalMoreThen500': invoice.total > 500,
            'client_name_present': response1.client_name_present,
            'is_alcohol_only': response1.is_alcohol_only,
            'totalMoreThen1500': invoice.total > 1500,
            'class': response1.class || "economy",
            'total': invoice.total,
            'monthly_subscription': response1.monthly_subscription,
            'totalMoreThen200': invoice.total > 200,
            'amountInUSD': invoice.amountInUSD || invoice.total,
            'CurrencyConverted': invoice.currency != "USD" ? true : false,
            'totalMoreThen25': invoice.total > 25,
            'ReceiptPresent': invoice.receiptPresent ? true : false,
            'VendorUnKnown': invoice.vendorKnown ? false : true,
            'sums_not_equal': parseInt(response1.total_items_sum + invoice.taxAmount) != parseInt(invoice.total),
            'totalMoreThen250': invoice.total > 250,
        };

        const policies = [];

        if (invoice.category == "meals") {
            policies.push(
                {
                    'condition': 'IF per_person > 75',
                    'rule_id': 'MEAL-01'
                }

            );
            policies.push(
                {
                    'condition': 'IF totalMoreThen500 == true AND client_name_present == false',
                    'rule_id': 'MEAL-02'
                }
            );
            policies.push({
                'condition': 'IF is_alcohol_only = true',
                'rule_id': 'MEAL-03'
            });

        }
        if (invoice.category == "travel") {
            policies.push(
                {
                    'condition': 'IF totalMoreThen1500 == true',
                    'rule_id': 'TRAVEL-02'
                });
            policies.push({
                'condition': 'IF class = "first" or class = "business"',
                'rule_id': 'TRAVEL-03'
            });
        }

        if (invoice.category == "saas") {
            policies.push(
                {
                    'condition': 'IF totalMoreThen200 == true AND monthly_subscription == true',
                    'rule_id': 'SAAS-01'
                });
        }

        if (invoice.category == "hardware") {
            policies.push({
                'condition': 'IF total > 1000',
                'rule_id': 'HW-02'
            });
        }

        policies.push({

            'condition': 'IF amountInUSD > 1000 AND CurrencyConverted == true',
            'rule_id': 'GLOBAL-FX'

        });
        policies.push({

            'condition': 'IF totalMoreThen25 == true AND ReceiptPresent == false',
            'rule_id': 'GLOBAL-RECEIPT'
        });
        policies.push({

            'condition': 'IF VendorUnKnown == true',
            'rule_id': 'GLOBAL-VENDOR'
        });
        policies.push({

            'condition': 'IF sums_not_equal == true',
            'rule_id': 'GLOBAL-MATH'
        });
        policies.push({

            'condition': 'IF totalMoreThen250 == true',
            'rule_id': 'AUTONOMY-CEILING'
        });



        /*
        for (const policy of policies) {
            Object.assign(variables, policy.variables);
        }*/

        const variablesString = Object.entries(variables).map(([key, value]) => `- ${key}: ${value}`).join("\n");

        const prompt2 = `You are a policy engine. Evaluate all rules.

Rules - use exactly this logic:
${policies.map((policy, p) => `${p + 1}. ${policy.rule_id}: ${policy.condition}`).join("\n")}


Input JSON is provided by user.
${variablesString}

Return ONLY JSON in this format:
{
  "evaluations": {
    ${policies.map(policy => `"${policy.rule_id}": true/false`).join(",\n    ")}
  },
  "violated_rules": ["..."],
  "confidence": 1.0,
  "reasoning": "short explanation"
}

Confidence: 1.0 if all inputs present, 0.5 if any input missing.`;
        console.log(`Prompt2: ${prompt2} `);
        console.log(`----------------------------------------------------- `);

        const response2 = await this.requestOllama(trackingId, prompt2, this.modelName);
        console.log(`[${trackingId}](${this.modelName})[${Date.now() - t1}ms] Final Response: `, response2);
        const violatedRules = response2.violated_rules || [];
        const confidence = parseFloat(response2.confidence || 0);


        let recommendation = "AUTO_APPROVE";
        if (violatedRules.length > 0) {
            recommendation = "HUMAN_REVIEW";
        }
        if (violatedRules.includes("MEAL-03")) {
            recommendation = "REJECT";
        }

        const result = {
            recommendation: recommendation,
            reason: response2.reasoning || reason,
            confidence: confidence,
            triggered_rules: violatedRules,
            model: this.modelName
        };
        console.log(`[${trackingId}](${this.modelName}) Result: `, result);
        return result;
    }

    async requestOllama(trackingId, prompt, modelName) {
        try {
            const response = await this.aiEngine.chat({
                model: modelName,
                messages: [
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                options: {
                    temperature: 0.0,
                    top_p: 0.1,
                    num_predict: 150,    // JSON-answer

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
            return JSON.parse(rawContent);

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

}
module.exports = { ollamaProvider };