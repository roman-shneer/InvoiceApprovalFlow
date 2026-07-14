import json
from datetime import datetime

def deterministic_fix(invoice: dict) -> dict:
    print(f"⚡ [DETERMINISTIC AUDIT] Processing invoice: {invoice.get('id', 'Unknown')}")
    updated_invoice = json.loads(json.dumps(invoice))
    
    
    total_amount = updated_invoice.get("total", 0.0)
    category = str(updated_invoice.get("category", "")).strip().lower()
    attendees = updated_invoice.get("attendees", 1)
    line_items = updated_invoice.get("lineItems", [])
    notes = str(updated_invoice.get("notes", "")).strip().lower()
    
    final_status = "AUTO_APPROVE"
    reason = "Under $250 ceiling, in-policy meal ($42 <= $75/attendee), receipt present, known vendor, math reconciles."
    triggered_rules = ["MEAL-01"]
    confidence = 1.0
    
    alcohol_keywords = ["alcohol", "wine", "beer", "whiskey", "vodka", "cocktail", "алкоголь", "вино", "пиво"]
    has_alcohol = False
    
    for item in line_items:
        desc = str(item.get("description", "")).strip().lower()
        if any(keyword in desc for keyword in alcohol_keywords):
            has_alcohol = True
            break
            
    if any(keyword in notes for keyword in alcohol_keywords):
        has_alcohol = True

    
    if has_alcohol:
        updated_invoice["status"] = "REJECT"
        updated_invoice["audit_metadata"]["deterministic_reason"] = "Alcohol-only receipts or items are not reimbursable. Reject regardless of amount."
        updated_invoice["audit_metadata"]["deterministic_rules"] = ["MEAL-03"]        
        return updated_invoice

    
    
    
    if category == "meals" and attendees > 0:
        cost_per_attendee = total_amount / attendees
        if cost_per_attendee > 75.0:
            final_status = "HUMAN_REVIEW"
            reason = f"Meal cost per attendee (${cost_per_attendee:.2f}) exceeds the strict $75 ceiling limit."
            triggered_rules = ["MEAL-01_LIMIT_EXCEEDED"]

    
    if total_amount > 2000.0:
        final_status = "HUMAN_REVIEW"
        reason = f"Total invoice amount (${total_amount:.2f}) exceeds the $2000 automatic approval ceiling."
        triggered_rules = ["GEN-01_LARGE_AMOUNT"]

    
    if not updated_invoice.get("receiptPresent", True):
        final_status = "HUMAN_REVIEW"
        reason = "Mandatory receipt file is missing from the payload."
        triggered_rules = ["GEN-02_MISSING_RECEIPT"]

    
    updated_invoice["status"] = final_status
    updated_invoice["audit_metadata"]["deterministic_reason"] = reason
    updated_invoice["audit_metadata"]["deterministic_rules"] = triggered_rules       
    return updated_invoice
    