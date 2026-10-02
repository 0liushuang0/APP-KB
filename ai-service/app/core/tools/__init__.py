"""工具调用注册中心。

GLM-5.2 的 function calling 让模型能"主动调工具"：模型收到工具清单后，自行判断
要不要调、调哪个、传什么参数，我们把执行结果回传给它继续生成。

这里只注册**只读**工具（检索类）。写操作工具（建需求、改报价等）必须先有前端
二次确认 UI 与权限校验，再开放 —— 否则 AI 越权改数据是新风险面。
"""

from app.core.tools.registry import (
    TOOL_REGISTRY,
    build_tool_schemas,
    exec_tool,
    READ_ONLY_TOOLS,
)

__all__ = ["TOOL_REGISTRY", "build_tool_schemas", "exec_tool", "READ_ONLY_TOOLS"]
