import json
from typing import Dict, List, Optional

from fastapi import APIRouter, Security
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from app.core.auth import verify_api_key
from app.core.llm_router import llm_router
from app.core.tools import build_tool_schemas

router = APIRouter(dependencies=[Security(verify_api_key)])


class ChatMessage(BaseModel):
    role: str = Field(..., max_length=30)
    content: str = Field(..., max_length=50_000)

    @field_validator("role")
    @classmethod
    def _valid_role(cls, v: str) -> str:
        allowed = {"system", "user", "assistant", "tool"}
        if v not in allowed:
            raise ValueError(f"role 只能是 {allowed} 之一")
        return v


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(..., max_length=50)
    module: str = Field(default="default", max_length=50)
    stream: bool = False
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0)


@router.post("/chat")
async def chat(request: ChatRequest):
    # ChatMessage → dict，llm_router 期望原始 dict 结构
    messages = [m.model_dump() for m in request.messages]
    response = await llm_router.chat(
        messages=messages,
        module=request.module,
        stream=request.stream,
        temperature=request.temperature,
    )
    return {"content": response}


class RAGChatRequest(BaseModel):
    query: str = Field(..., max_length=10_000)
    context: str = Field(..., max_length=50_000)
    module: str = Field(default="default", max_length=50)
    history: List[Dict] = Field(default_factory=list, max_length=12)
    stream: bool = False
    # 页面助手送来的"用户此刻看到什么"。
    #
    # 与 context 分开传，不要拼成一段：拼在一起后模型分不清哪部分带编号，
    # 很容易把页面内容也标成 [1]，而前端是按 sources[n-1] 去找对应记录的 ——
    # 点 [1] 就跳到一条毫不相干的数据上。分开传，编号只属于检索结果。
    page_context: str = Field(default="", max_length=20_000)


# ── 回答形态约束 ───────────────────────────────────────────────
#
# 回答显示在聊天气泡里（页面助手宽 384px），不是文档页面。
# 模型默认爱用 `## 标题` 和表格，在这个宽度里要么撑破布局，要么在
# 不渲染 Markdown 的地方原样露出 "#"、"**" 这些符号。
# 所以直接在提示词里限死输出形态，比在前端事后清洗可靠。
_FORMAT_RULES = """【排版】
· 直接写正文，不要用 Markdown 标题（不要出现 #、##、###）。
· 不要用表格，不要用代码块（```）。
· 需要罗列时用「- 」开头的短句，最多一层，不要嵌套。
· 加粗（**）只用在关键结论或关键数字上，一段最多一处；其余一律不用。
· 段落简短，不写"根据您提供的资料"这类开场白和客套话。"""

_FACT_RULES = """【事实边界】
· 结论里的每一项事实 —— 参数、价格、交期、型号、客户名、日期、数量 ——
  都必须在资料中有出处；资料里没有的，不要写。
· 数字逐字照抄，不换算、不估算、不四舍五入。资料写"45 天"就写 45 天，
  不要写成"约一个半月"。
· **允许**你对资料内的信息做归纳、比较、排序、计数、分组，并据此给出判断和建议。
  这不算编造 —— "哪几家该优先询价""金额怎么分布""哪条最该先处理"
  都应当正常回答，不要以"资料未提供"推脱。
· 资料确实不足以回答时，直接说明还缺什么、需要补充哪些信息，不要用推测填空。"""


def _build_rag_messages(request: RAGChatRequest) -> List[Dict]:
    """组装 RAG 提示词。

    改写要点（相对旧版）：
      1. 旧版第 2 条写的是"禁止使用任何外部知识、常识**或推理**"，把归纳、
         比较、排序也一并禁掉了。而页面助手的预设问题几乎全要推理
         （"本页哪些等级最高""今天最该处理的三件事"），模型要么拒答、
         要么违规硬答。现在把"不得编造**事实**"和"可以对资料做推理"分开说。
      2. 旧版提示词根本不知道有【当前页面内容】这一段（后端拼进去了却没说明），
         模型不知道该怎么对待它、要不要标编号。现在显式区分两类资料。
      3. 旧版的固定拒答话术里写着"请上传相关文档"，页面助手场景下答非所问 ——
         用户正在看列表，不需要上传任何东西。
      4. 新增排版约束，见 _FORMAT_RULES。
    """
    has_page = bool(request.page_context.strip())
    has_retrieved = bool(request.context.strip())

    if has_page:
        source_rules = """【资料的两个来源】
· 【当前页面内容】—— 用户此刻正在屏幕上看的数据（当前筛选、本页记录、选中的那条）。
  用户问"本页""这些""当前"时指的就是它，优先据此回答。
  引用它时写「本页」，**不要**给它编号。
· 【知识库检索结果】—— 从系统里检索出来的记录，每条前面自带 [1]、[2] 这样的编号。
  引用它时必须原样使用它自带的编号。"""
    else:
        source_rules = """【资料来源】
· 下方【知识库检索结果】中的记录，每条前面自带 [1]、[2] 这样的编号。"""

    cite_rules = """【引用】
· 关键事实后标出处：来自检索结果的写 [数字]，来自当前页面的写「本页」。
· 编号只能用【知识库检索结果】里实际出现过的那些，不要自己新编或续编号。"""

    blocks = [
        "你是博亚精工的业务知识助手，服务对象是售前与技术支持人员。",
        source_rules,
        _FACT_RULES,
        cite_rules,
        _FORMAT_RULES,
        "【回答顺序】先给结论，再给依据，最后列出还需要确认的事项（没有就不写）。",
    ]

    if has_page:
        blocks.append(f"【当前页面内容】\n{request.page_context}")
    blocks.append(
        "【知识库检索结果】\n" + (request.context if has_retrieved else "（本次没有检索到相关记录）")
    )

    system_prompt = "\n\n".join(blocks)

    history = [
        {"role": item.get("role"), "content": str(item.get("content", ""))[:10_000]}
        for item in request.history[-12:]
        if item.get("role") in {"user", "assistant"} and item.get("content")
    ]
    return [
        {"role": "system", "content": system_prompt},
        *history,
        {"role": "user", "content": request.query},
    ]


@router.post("/rag-chat")
async def rag_chat(request: RAGChatRequest):
    messages = _build_rag_messages(request)

    if request.stream:
        # 流式返回 SSE
        #
        # token 必须 JSON 编码后再放进 data 字段，不能直接内插。
        # SSE 以 "\n" 分帧，而模型吐出的 token 本身经常带换行：
        #   · token = "。\n2. 第二项"  → 帧里第二行不以 "data: " 开头，接收端整段丢弃
        #   · token = "\n\n"（段落分隔，最常见的一种 delta）
        #                              → 帧变成 "data: \n\n\n\n"，行尾空格被 trim 掉后
        #                                变成 "data:"，前缀不匹配，整条丢弃
        #   · token 末尾的空格同样会被接收端 trim 吃掉，型号与后文粘连
        # 结果不是"格式乱"，是**正文被静默丢失**。json.dumps 会把 \n 转义成 \\n，
        # 帧内不再出现裸换行，接收端按行切分才是安全的。
        async def generate():
            async for token in llm_router.chat_stream(
                messages=messages,
                module=request.module,
                # 事实问答要的是"照着资料说"，不是发挥。0.5 会让模型
                # 在措辞上自由发挥，连带把数字也"润色"掉。
                temperature=0.2,
            ):
                yield "data: " + json.dumps({"t": token}, ensure_ascii=False) + "\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    response = await llm_router.chat(
        messages=messages,
        module=request.module,
        # 与流式分支保持一致：事实问答用低温度
        temperature=0.2,
    )
    return {"content": response}


class ToolChatRequest(BaseModel):
    """带工具调用的对话。

    use_tools：开 function calling（GLM-5.2 + 本地只读工具，如知识库检索），
                让模型能自主多轮查库。
    use_web_search：开内置联网搜索（glm_web_search_model，默认 glm-4-air）。
    两者可同开：先联网取最新资料注入上下文，再走工具循环回答。
    两者都关时，等价于普通 /chat。
    """
    messages: List[ChatMessage] = Field(..., max_length=50)
    module: str = Field(default="default", max_length=50)
    use_tools: bool = False
    use_web_search: bool = False
    temperature: Optional[float] = Field(default=0.7, ge=0.0, le=2.0)


@router.post("/tool-chat")
async def tool_chat(request: ToolChatRequest):
    """带工具调用的对话端点（GLM-5.2）。

    编排顺序：
      1. 若 use_web_search，先用 glm-4-air + 内置 web_search 取一轮联网资料，
         作为 system 上下文追加进对话（让最终答案能引用最新外部信息）。
      2. 若 use_tools，用 glm-5.2 跑 function calling 循环（本地只读工具）；
         否则退回普通 chat()。
    返回 {content, tool_trace, tools_used, web_search_used}，便于前端展示工具轨迹。
    """
    messages = [m.model_dump() for m in request.messages]
    tool_trace: List[Dict] = []
    web_search_used = False

    # ① 联网搜索增强
    if request.use_web_search:
        ws = await llm_router.chat_with_web_search(messages, module=request.module)
        web_search_used = bool(ws.get("web_search_used"))
        ws_content = (ws.get("content") or "").strip()
        if web_search_used and ws_content:
            # 把联网资料作为一条 system 消息前置，不替换用户原意
            messages = messages[:-1] + [
                {"role": "system", "content": f"【联网搜索参考资料】\n{ws_content}"},
                messages[-1],
            ]

    # ② 工具调用循环 / 普通 chat
    if request.use_tools:
        result = await llm_router.chat_with_tools(
            messages=messages,
            module=request.module,
            tool_schemas=build_tool_schemas(),
        )
        return {
            "content": result.get("content", ""),
            "tool_trace": result.get("tool_trace", tool_trace),
            "tools_used": bool(result.get("tools_used")),
            "web_search_used": web_search_used,
            **{k: v for k, v in result.items()
               if k in {"truncated", "fallback", "error", "egress_blocked"} and v},
        }

    response = await llm_router.chat(
        messages=messages,
        module=request.module,
        stream=False,
        temperature=request.temperature,
    )
    return {
        "content": response,
        "tool_trace": tool_trace,
        "tools_used": False,
        "web_search_used": web_search_used,
    }


@router.get("/health")
async def llm_health():
    """检查所有 LLM 提供商的连通性（含 Ollama）"""
    return await llm_router.health_check()
