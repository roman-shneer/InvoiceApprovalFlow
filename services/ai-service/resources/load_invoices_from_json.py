
import os
import json

def load_invoices_from_json():
    file_path = "docs/sample-invoices.json"        
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Критическая ошибка: Файл {file_path} не найден!")
            
    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)
        
   
    invoices_list = data.get("fixtures", [])
    
    return invoices_list