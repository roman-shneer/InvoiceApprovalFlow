import asyncio
import warnings
import json
from datetime import datetime

warnings.filterwarnings("ignore")
import  logging
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("ollama").setLevel(logging.WARNING)
logging.getLogger("mcp").setLevel(logging.WARNING)

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from langchain_ollama import ChatOllama
from langchain_core.tools import StructuredTool 
from pydantic import create_model


async def _execute_agent_workflow(invoice_data: dict) -> dict:    
    server_params = StdioServerParameters(
        command="python3",
        args=["-u", "mcp_server.py"]
    )
    
    async with stdio_client(server_params) as (read_stream, write_stream):
        async with ClientSession(read_stream, write_stream) as session:            
            await session.initialize()                    
            mcp_tools_response = await session.list_tools()                        
            tool_name = "audit_invoice_via_rag"
            has_tool = any(t.name == tool_name for t in mcp_tools_response.tools)
            
            tool_output_json = {}
            
            if has_tool:
                try:                    
                    res = await session.call_tool(tool_name, arguments={"invoice_payload_str": invoice_data})
                    
                    if res.content and len(res.content) > 0:
                        first_item = res.content[0]
                        raw_text = getattr(first_item, "text", str(first_item))
                        tool_output_json = json.loads(raw_text)
                except Exception as e:
                    print(f"[MCP CALL ERROR]: {e}")
            else:
                print(f"[MCP ERROR]: Tool '{tool_name}' not found on the MCP server.")

            
            if not tool_output_json:
                tool_output_json = {
                    "recommendation": "HUMAN_REVIEW",
                    "reason": "Execution failed during direct MCP session tool invocation.",
                    "confidence": 0.0,
                    "triggered_rules": ["MCP_DIRECT_CALL_FALLBACK"]
                }
                
            return tool_output_json


def run_invoice_agent(invoice_data: dict) -> dict:
    
    updated_invoice = json.loads(json.dumps(invoice_data))
    
    final_result = asyncio.run(_execute_agent_workflow(updated_invoice))
    print("FINAL RESULT ",final_result)
    recommendation = final_result.get("recommendation", "HUMAN_REVIEW").upper()
    if "APPROVE" in recommendation:
        final_status = "AUTO_APPROVE"
    elif "REJECT" in recommendation:
        final_status = "REJECT"
    else:
        final_status = "HUMAN_REVIEW"
        
    updated_invoice["status"] = final_status
    updated_invoice["audit_metadata"] = {
        "checked_at": datetime.utcnow().isoformat() + "Z",
        "reason": final_result.get("reason", "No reason provided by auditor."),
        "triggered_rules": final_result.get("triggered_rules", []),
        "confidence": final_result.get("confidence", 0.0),
        "status": final_status
    }
    
    return updated_invoice
