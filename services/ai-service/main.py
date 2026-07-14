import time
from dapr.clients import DaprClient
from datetime import datetime, timezone
from resources.run_invoice_agent import run_invoice_agent
from engines.deterministic_fix import deterministic_fix
import time
import json 
import logging
from datetime import timedelta


logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("ollama").setLevel(logging.WARNING)
logging.getLogger("mcp").setLevel(logging.WARNING)

def publish_invoice_processed(invoice_data: dict, topic_name:str="invoice.processed"):
    """
    Publishes the processed invoice data to the 'invoice.processed' topic.
    """
    try:
        with DaprClient() as client:
            client.publish_event(
                pubsub_name="approval-pubsub",
                topic_name=topic_name,
                data=json.dumps(invoice_data, ensure_ascii=False),
                data_content_type="application/json"
            )
        print(f"📤 [DAPR PUBLISH] Published processed invoice {invoice_data.get('id')} to '{topic_name}' topic.")
    except Exception as e:
        print(f"❌ [DAPR PUBLISH ERROR] Failed to publish processed invoice {invoice_data.get('id')}: {e}")

def query_invoices_by_status(limit: int = 1):    
    current_time_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    
    query_definition = {
        "filter": {
            "OR": [
                {
                    "EQ": { "status": "PENDING" }
                },
                {
                    "AND": [
                        { "EQ": { "status": "PROCESSING" } },
                        { "LT": { "lock_until": current_time_ms } }
                    ]
                }
            ]
        },
        "page": { "limit": limit },
        "sort": [{ "key": "created_at", "order": "ASC" }]
    }
    
    with DaprClient() as client:
        response = client.query_state(
            store_name="mongo-invoices",
            query=json.dumps(query_definition)
        )
        return response.results
    
    
    

def save_updated_invoice(invoice_key: str, processed_invoice: dict) -> bool:    
    print(f"💾 [DAPR SAVE] Synchronizing invoice {invoice_key} with database...")    
    invoice_json_str = json.dumps(processed_invoice, ensure_ascii=False)
    
    try:
        with DaprClient() as client:            
            client.save_state(
                store_name="mongo-invoices",
                key=invoice_key,
                value=invoice_json_str
            )
        print(f"🎉 [DAPR SUCCESS] Invoice {invoice_key} successfully updated to status: {processed_invoice['status']}")
        return True
    except Exception as e:
        print(f"❌ [DAPR SAVE ERROR] Failed to save invoice {invoice_key}: {e}")
        return False

def run_worker():       
    print("run_worker started...") 
    while True:        
        invoices=query_invoices_by_status(1)
        print(f"Check Invoices: {len(invoices)}")
        if len(invoices)>0:
            for invoice in invoices:
                
                invoice_data=json.loads(invoice.value.decode('utf-8'))
                now = datetime.now(timezone.utc)
                lock_datetime = now + timedelta(minutes=5)
                lock_timestamp_ms = int(lock_datetime.timestamp() * 1000)
                invoice_data["status"]="PROCESSING"
                invoice_data["lock_until"] = lock_timestamp_ms                
                save_updated_invoice(invoice.key, invoice_data)
                
                publish_invoice_processed(invoice_data, topic_name="invoice.processing") 
                print(f" Processing invoice {invoice.key} with status {invoice_data.get('status')}...")
                processed_invoice = run_invoice_agent(invoice_data)
                
                if processed_invoice.get("status") == "AUTO_APPROVE":
                    processed_invoice = deterministic_fix(processed_invoice)
                
                save_updated_invoice(invoice.key, processed_invoice)
                
                publish_invoice_processed(processed_invoice)
                if processed_invoice.get("status") == "AUTO_APPROVE":
                    publish_invoice_processed(processed_invoice, topic_name="payment.requested")
            time.sleep(1) 
        else:          
            time.sleep(5)  # Sleep for 5 seconds before checking again                 

print("Name",__name__)
if __name__ == "__main__":
    run_worker()
