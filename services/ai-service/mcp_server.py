import json
from mcp.server.fastmcp import FastMCP
from resources.rag_orchestrator import RagOrchestrator 

mcp = FastMCP("InvoiceComplianceSystem")
orchestrator = RagOrchestrator(modelName="qwen2.5-coder:1.5b")

@mcp.tool()
def audit_invoice_via_rag(invoice_payload_str: dict) -> str:
    """
    Performs an automated corporate policy compliance audit on the invoice data using RAG.
    """    
    result = orchestrator.process_invoice_from_mcp(invoice_payload_str)
    return json.dumps(result, ensure_ascii=False)

if __name__ == "__main__":
    mcp.run(transport="stdio")
