import json
from resources.run_invoice_agent import run_invoice_agent
from resources.load_invoices_from_json import load_invoices_from_json
import time
import  logging
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("ollama").setLevel(logging.WARNING)
logging.getLogger("mcp").setLevel(logging.WARNING)

def test_invoices():
    invoices = load_invoices_from_json()
    processed = 0
    correct = 0
    start_time = time.perf_counter()
    for index, invoice in enumerate(invoices):
        print(f"Invoice {invoice['id']}")
        start_one_time = time.perf_counter()        
        response = run_invoice_agent(invoice)
        
        
        
        recommendation = response.get("status", "").lower()
        expected_recommendation = invoice['expected']['route'].lower()
        processed+=1
        if recommendation == expected_recommendation:
            correct+=1
        else:
            print(invoice)       
            print(response)
                    
        print(f"**** Progress: {processed} ({correct/processed*100:.2f}%) Time:{time.perf_counter() - start_one_time:.2f} seconds")
        print("------------------------------")
    end_time = time.perf_counter()
    print("===============================")
    print(f"Correct recommendations: {correct} out of {processed} ({correct/processed*100:.2f}%) Time:{end_time - start_time:.2f} seconds")
    
    
    assert True, "Test finished."


if __name__ == "__main__":
    test_invoices()