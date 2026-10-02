"""工具注册表。

每个工具登记三项：
  · schema  —— OpenAI 兼容的 function 描述（直接放进请求的 tools 数组）
  · handler —— async (args: dict) -> Any，执行工具返回结果（会被 json.dumps 回传给模型）
  · mode    —— "read" 只读 / "write" 写操作（写操作需调用方做权限校验 + 二次确认）

目前只开放只读检索工具。新增写工具时务必：先确认 mode，并在调用层加权限闸与确认。
"""

import asyncio
import json
from typing import Any, Awaitable, Callable, Dict, List

# 延迟导入 rag_service：tools 模块被 llm_router 在加载期引用，而 rag_service 自身
# 又依赖较重的模型/索引初始化，放函数内部 import 避免循环导入与启动期开销。
ToolHandler = Callable[[Dict[str, Any]], Awaitable[Any]]


async def _search_knowledge(args: Dict[str, Any]) -> Any:
    """在知识库里做向量+关键词混合检索，返回最相关的若干分块。

    让 AI 能"自主多轮查库"：复杂问题（对比、跨客户汇总）一轮检索召回不全时，
    模型可以自己换关键词再查一次，而不是被单次硬连线的检索结果限死。
    """
    from app.core.rag import rag_service

    query = str(args.get("query", "")).strip()
    if not query:
        return {"error": "query 不能为空"}

    source_types = args.get("source_types") or args.get("source_type")
    if isinstance(source_types, str):
        source_types = [source_types]
    top_k = int(args.get("top_k") or 5)

    # rag_service.search 是同步 CPU 密集操作，裸调会阻塞事件循环
    # （见 customer_matching.py:114 的同类缺陷）。包到线程里跑。
    results = await asyncio.to_thread(
        rag_service.search,
        query,
        source_types if isinstance(source_types, list) else None,
        top_k,
    )

    # 只回传模型生成答案真正需要的字段：正文、来源、相关度。
    # permission_snapshot 是行级权限快照，对模型无用且可能含敏感标识，剥掉。
    trimmed = [
        {
            "source_type": r.get("source_type"),
            "source_id": r.get("source_id"),
            "content": r.get("content"),
            "score": r.get("score"),
        }
        for r in results
    ]
    return {"query": query, "count": len(trimmed), "results": trimmed}


# ── 工具注册表 ────────────────────────────────────────────────
TOOL_REGISTRY: Dict[str, Dict[str, Any]] = {
    "search_knowledge": {
        "schema": {
            "type": "function",
            "function": {
                "name": "search_knowledge",
                "description": (
                    "在本地知识库（客户/需求/方案/报价/合同/文档等业务对象）中做语义+关键词"
                    "混合检索。当你需要核实具体数据、对比历史记录、查某客户/项目的详情时调用。"
                    "一次召回不全时，可换关键词再次调用。"
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "检索用自然语言或关键词，例如：液压锁紧装置 历史需求",
                        },
                        "source_types": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "限定检索对象类型，可选项如 customer/requirement/proposal/quotation/contract/document；不传则全库检索",
                        },
                        "top_k": {
                            "type": "integer",
                            "description": "返回条数，默认 5，最大 50",
                        },
                    },
                    "required": ["query"],
                },
            },
        },
        "handler": _search_knowledge,
        "mode": "read",
    },
}

READ_ONLY_TOOLS = [name for name, t in TOOL_REGISTRY.items() if t["mode"] == "read"]


def build_tool_schemas(names: List[str] = None) -> List[Dict[str, Any]]:
    """生成放进请求 tools 数组的 schema 列表。names 为空时返回全部只读工具。"""
    if names is None:
        names = READ_ONLY_TOOLS
    return [TOOL_REGISTRY[n]["schema"] for n in names if n in TOOL_REGISTRY]


async def exec_tool(name: str, args: Dict[str, Any]) -> str:
    """执行工具并把结果序列化成回传给模型用的 JSON 字符串。"""
    tool = TOOL_REGISTRY.get(name)
    if tool is None:
        return json.dumps({"error": f"未知工具: {name}"}, ensure_ascii=False)
    try:
        result = await tool["handler"](args or {})
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception as exc:  # noqa: BLE001 —— 工具异常不能炸掉整条对话，回传错误让模型自处理
        return json.dumps({"error": f"工具执行失败: {exc}"}, ensure_ascii=False)
