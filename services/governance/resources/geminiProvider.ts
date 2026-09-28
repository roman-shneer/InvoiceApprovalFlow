// ---- INLINE TYPES ----
interface Invoice {
    [key: string]: any;
}

interface AiResponseRaw {
    rules?: string[];
    reason?: string;
    confidence?: number;
    recommendation?: string;
}

interface NormalizedAiResult {
    triggered_rules: string[];
    reason: string;
    confidence: number;
    recommendation: string;
    model: string;
}

export class geminiProvider {
    aiEngine: any = null;
    modelName: string = process.env.AI_MODEL_NAME || "gemini-3.6-flash";

    private async getEngine(): Promise<any> {
        if (this.aiEngine) return this.aiEngine;
        // Динамический import - единственный способ импортировать ESM из CommonJS в TS
        const mod = await import('@google/genai' as any);
        const GoogleGenAI = (mod as any).GoogleGenAI || (mod as any).default?.GoogleGenAI || (mod as any).default;
        this.aiEngine = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
        return this.aiEngine;
    }

    constructor() {
        // не инициализируем в конструкторе, иначе будет top-level ESM ошибка
    }

    async requestModel(trackingId: string, invoice: Invoice, policyContext: string[]): Promise<NormalizedAiResult> {
        const engine = await this.getEngine();

        const prompt = `You are a policy engine... 
    Invoice: ${JSON.stringify(invoice)}
    Policies: ${policyContext.join("\n")}
    `;

        const result = await engine.models.generateContent({
            model: this.modelName,
            contents: prompt,
            config: {
                responseMimeType: "application/json"
            }
        });

        const rawText = result.text || result.response?.text?.() || "{}";
        const parsed = JSON.parse(rawText) as AiResponseRaw;

        return {
            triggered_rules: parsed.rules || [],
            reason: parsed.reason || "Evaluated by Gemini",
            confidence: parsed.confidence ?? 0.95,
            recommendation: parsed.recommendation || "HUMAN_REVIEW",
            model: this.modelName
        };
    }
}