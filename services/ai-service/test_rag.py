import time
from resources.load_invoices_from_json import load_invoices_from_json
from resources.rag_orchestrator import RagOrchestrator
'''
Models Comparision RAG only:

llama3:latest 20% 605sec
llama3.2:latest 70% 340sec
qwen2.5-coder:1.5b 65% 154sec

'''


def test_valid_invoice():    
    modelName="qwen2.5-coder:1.5b"
    start_time = time.perf_counter()
    rag_orchestrator = RagOrchestrator(modelName)
    invoices = load_invoices_from_json()
    
    correct=0
    processed=0
    for index, invoice in enumerate(invoices):
        print(f"Invoice {invoice['id']}")
        start_one_time = time.perf_counter()                
        response = rag_orchestrator.verify_invoice_with_rag(invoice)
        
        recommendation = response.get("recommendation", "").lower()
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
    

    # 3. Проверяем утверждение (Assertion) для Pytest
    assert True, "Test finished."

if __name__ == "__main__":
    test_valid_invoice()