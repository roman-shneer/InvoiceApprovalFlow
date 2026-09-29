import { Ollama } from 'ollama';

// ---- INLINE TYPES ----
interface LineItem {
    description: string;
    unitPrice: number;
    quantity: number;
    [key: string]: any;
}

interface Invoice {
    date: string;
    total: number;
    taxAmount?: number;
    attendees?: number;
    lineItems: LineItem[];
    receiptPresent?: boolean;
    vendorKnown?: boolean;
    category?: string;
    amountInUSD?: number;
    currency?: string;
    [key: string]: any;
}

interface ExtractorResponse {
    per_person: number;
    client_name?: string;
    client_name_present: boolean;
    is_alcohol_only: boolean;
    total_items_sum: number;
    class: 'economy' | 'business' | 'first' | string;
    monthly_subscription: boolean;
    [key: string]: any;
}

interface PolicyDef {
    condition: string;
    rule_id: string;
}

interface Variables {
    per_person: number;
    totalMoreThen500: boolean;
    client_name_present: boolean;
    is_alcohol_only: boolean;
    totalMoreThen1500: boolean;
    class: string;
    total: number;
    monthly_subscription: boolean;
    totalMoreThen200: boolean;
    amountInUSD: number;
    CurrencyConverted: boolean;
    totalMoreThen25: boolean;
    ReceiptPresent: boolean;
    VendorUnKnown: boolean;
    sums_not_equal: boolean;
    totalMoreThen250: boolean;
    [key: string]: any;
}

interface PolicyEngineResponse {
    evaluations?: Record<string, boolean>;
    violated_rules?: string[];
    confidence?: number;
    reasoning?: string;
    [key: string]: any;
}

interface NormalizedResult {
    recommendation: string;
    reason: string;
    confidence: number;
    triggered_rules: string[];
    model: string;
}

export class ollamaProvider {
    aiEngine: any = null;
    modelName: string = process.env.AI_MODEL_NAME || 'llama3';

    constructor() {
        const API_URL = process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434';
        console.log(`[ollamaProvider] Using Ollama API URL: ${API_URL}`);
        this.aiEngine = new Ollama({ host: API_URL });
    }

    async requestModel(
        trackingId: string,
        invoice: Invoice,
        policyComplects: string[]
    ): Promise<NormalizedResult> {

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
        const response1 = await this.requestOllama(trackingId, prompt1, this.modelName) as ExtractorResponse;
        console.log(`[${trackingId}](${this.modelName})[${Date.now() - t1}ms] First Response: `, response1);
        console.log(`-----------------------------------------------------`);

        let variables: Variables = {
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
            'sums_not_equal': parseInt((response1.total_items_sum + (invoice.taxAmount || 0)) as any) != parseInt(invoice.total as any),
            'totalMoreThen250': invoice.total > 250,
        };

        const policies: PolicyDef[] = [];

        if (invoice.category == "meals") {
            policies.push({ 'condition': 'IF per_person > 75', 'rule_id': 'MEAL-01' });
            policies.push({ 'condition': 'IF totalMoreThen500 == true AND client_name_present == false', 'rule_id': 'MEAL-02' });
            policies.push({ 'condition': 'IF is_alcohol_only = true', 'rule_id': 'MEAL-03' });
        }
        if (invoice.category == "travel") {
            policies.push({ 'condition': 'IF totalMoreThen1500 == true', 'rule_id': 'TRAVEL-02' });
            policies.push({ 'condition': 'IF class = "first" or class = "business"', 'rule_id': 'TRAVEL-03' });
        }
        if (invoice.category == "saas") {
            policies.push({ 'condition': 'IF totalMoreThen200 == true AND monthly_subscription == true', 'rule_id': 'SAAS-01' });
        }
        if (invoice.category == "hardware") {
            policies.push({ 'condition': 'IF total > 1000', 'rule_id': 'HW-02' });
        }

        policies.push({ 'condition': 'IF amountInUSD > 1000 AND CurrencyConverted == true', 'rule_id': 'GLOBAL-FX' });
        policies.push({ 'condition': 'IF totalMoreThen25 == true AND ReceiptPresent == false', 'rule_id': 'GLOBAL-RECEIPT' });
        policies.push({ 'condition': 'IF VendorUnKnown == true', 'rule_id': 'GLOBAL-VENDOR' });
        policies.push({ 'condition': 'IF sums_not_equal == true', 'rule_id': 'GLOBAL-MATH' });
        policies.push({ 'condition': 'IF totalMoreThen250 == true', 'rule_id': 'AUTONOMY-CEILING' });

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

        const response2 = await this.requestOllama(trackingId, prompt2, this.modelName) as PolicyEngineResponse;
        console.log(`[${trackingId}](${this.modelName})[${Date.now() - t1}ms] Final Response: `, response2);

        const violatedRules = response2.violated_rules || [];
        const confidence = parseFloat((response2.confidence || 0) as any);

        let recommendation = "AUTO_APPROVE";
        if (violatedRules.length > 0) {
            recommendation = "HUMAN_REVIEW";
        }
        if (violatedRules.includes("MEAL-03")) {
            recommendation = "REJECT";
        }

        const result: NormalizedResult = {
            recommendation: recommendation,
            reason: response2.reasoning || "Evaluated by policy engine",
            confidence: confidence,
            triggered_rules: violatedRules,
            model: this.modelName
        };
        console.log(`[${trackingId}](${this.modelName}) Result: `, result);
        return result;
    }

    async requestOllama(trackingId: string, prompt: string, modelName: string): Promise<any> {
        try {
            const response = await this.aiEngine.chat({
                model: modelName,
                messages: [{ role: 'user', content: prompt }],
                options: {
                    temperature: 0.0,
                    top_p: 0.1,
                    num_predict: 150,
                    num_ctx: 512,
                    num_thread: 4,
                },
                format: 'json'
            });

            let rawContent = response.message.content.trim();

            if (rawContent.startsWith("```")) {
                rawContent = rawContent.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
            }
            return JSON.parse(rawContent);

        } catch (err: any) {
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

export type { Invoice, NormalizedResult };