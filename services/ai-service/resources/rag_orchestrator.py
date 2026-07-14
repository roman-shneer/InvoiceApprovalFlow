
import json
import os
import ollama
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity


class RagOrchestrator:
    def __init__(self, modelName="qwen2.5:1.5b"):       
        self.vector_database = []
        OLLAMA_URL = "http://127.0.0.1:11434"
        self.client = ollama.Client(host=OLLAMA_URL)
        self.vector_database = self.initialize_rag_vector_store()
        self.modelName=modelName

    def initialize_rag_vector_store(self):
        vector_database = []
        policy_path = "/app/docs/policy.md"
    
        if not os.path.exists(policy_path):
            raise FileNotFoundError(f"File {policy_path} not found!")

        with open(policy_path, "r", encoding="utf-8") as f:
            full_text = f.read()

   
        chunks = [c.strip() for c in full_text.split("\n\n") if len(c.strip()) > 10]
        print(f"📄 Policy successfully split into {len(chunks)} text chunks.")
    
        for chunk in chunks:            
            response = self.client.embeddings(
                model="nomic-embed-text",
                prompt=f"search_document: {chunk}"
            )
            embedding = response["embedding"]
            vector_database.append({
                "text": chunk,
                "vector": embedding
            })
        return vector_database
    
    
    def invoice_to_prompt(self,prefix:str, invoice: dict) -> str:      
        lineItems=", ".join([f"item: {i['description']}, quantity: {i['quantity']}, price: {i['unitPrice']};" for i in invoice.get('lineItems', [])])
        return (f"{prefix}: category {invoice['category']},"
                f"attendee {invoice['attendees']}," if 'attendees' in invoice else ''
                f"vendor {invoice['vendor']},"
                f"vendor status {'known' if invoice['vendorKnown'] else 'new'},"
                f"total {invoice['total']},"
                f"tax {invoice['taxAmount']}"
                f"currency {invoice['currency']},"
                f"receipt_present  {'yes' if invoice['receiptPresent'] else 'no'},"
                f"line items {lineItems}")
    
    
    def retrieve_relevant_context(self, invoice:dict, top_k: int = 2) -> str:
        
        response = self.client.embeddings(
            model="nomic-embed-text",
            #prompt=f"search_query: {invoice_text}"
            
            prompt=self.invoice_to_prompt("Invoice check", invoice)
        )
        invoice_vector = np.array(response["embedding"]).reshape(1, -1)

        
        scores = []
        for item in self.vector_database:
            db_vector = np.array(item["vector"]).reshape(1, -1)
            similarity = cosine_similarity(invoice_vector, db_vector)[0][0]
            scores.append((similarity, item["text"]))

    
        scores.sort(key=lambda x: x[0], reverse=True)
        relevant_chunks = [text for score, text in scores[:top_k]]
                
        return "\n\n".join(relevant_chunks)
    

    def verify_invoice_with_rag(self, invoice_data):
        invoice_text = json.dumps(invoice_data, indent=2, ensure_ascii=False)
        matched_policy_context = self.retrieve_relevant_context(invoice_data, top_k=4)

        system_instruction = f"""You are an uncompromising corporate FinOps Compliance Auditor. 
Your task is to analyze the user's invoice payload against the active corporate policies provided below.

ACTIVE CORPORATE POLICIES (EXTRACTED VIA RAG):
{matched_policy_context}

CRITICAL AUDITING STEPS (YOU MUST FOLLOW IN ORDER):
1. **Check for Fatal Violations First (REJECT Category)**:
   - Carefully scan the `lineItems` (descriptions), `category`, and `notes`.
   - Check if the receipt contains alcohol-only items, non-business categories, or missing mandatory IDs.
   - If ANY strict policy restriction (like rule MEAL-03: alcohol-only receipts) is violated, you MUST immediately set "recommendation": "REJECT", regardless of the total invoice amount.

2. **Check for Approval Limits (AUTO_APPROVE vs HUMAN_REVIEW)**:
   - If there are no fatal violations, evaluate the math: total amount, category ceilings, attendee limits (e.g., total / attendees), and receipt presence.
   - Route to "AUTO_APPROVE" only if ALL parameters are fully compliant and under the ceiling limits.
   - Route to "HUMAN_REVIEW" if the amount exceeds the ceiling limits or contains ambiguous entries.

You MUST return your response as a single, strict JSON object following this exact schema:
{{
"recommendation": "AUTO_APPROVE" or "HUMAN_REVIEW" or "REJECT",
"reason": "Detailed explanation in English citing the exact Rule ID (e.g., MEAL-03 or MEAL-01) that triggered this decision.",
"confidence": 0.95,
"triggered_rules": ["RULE_ID_HERE"]
}}"""
        
        prompt=self.invoice_to_prompt("Verify this invoice", invoice_data)
        #prompt=f"Verify this invoice: {invoice_text}"
        response = self.client.generate(
            model=self.modelName,
            system=system_instruction,
            prompt=prompt,
            options={"temperature": 0.0},
            format="json"
        )

        return json.loads(response["response"])
    
    
    def process_invoice_from_mcp(self, invoice_data: dict) -> dict:        
        invoice_id = invoice_data.get("id")
        if not invoice_id:
            return {"status": "error", "message": "Missing 'id' field in invoice payload"}

        print(f"🔍 Starting RAG-audit for invoice {invoice_id}...")

        try:
            rag_result = self.verify_invoice_with_rag(invoice_data)           
            print(f"📦 [OLLAMA RAW RESPONSE]: {rag_result}")
        except Exception as e:
            return {"status": "error", "message": f"RAG verification failed: {str(e)}"}

       
        rag_clean = {str(k).lower(): v for k, v in rag_result.items()} if isinstance(rag_result, dict) else {}

       
        recommendation = str(rag_clean.get("recommendation", "HUMAN_REVIEW")).upper()
        
        if "APPROVE" in recommendation:
            final_status = "AUTO_APPROVE"
        elif "REJECT" in recommendation:
            final_status = "REJECT"
        else:
            final_status = "HUMAN_REVIEW"

       
        final_reason = rag_clean.get("reason", rag_result.get("Reason", "No reason provided by auditor."))
        final_rules = rag_clean.get("triggered_rules", rag_clean.get("triggered_rule", []))
        final_confidence = rag_clean.get("confidence", 0.0)

        return {
            "recommendation": final_status,
            "reason": final_reason,
            "triggered_rules": final_rules,
            "confidence": final_confidence
        }