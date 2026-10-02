import json
import asyncio
import aiohttp
from typing import AsyncGenerator, Dict, Any, Optional, Tuple
from app.core import egress
from app.core.config import get_settings

MAX_RETRIES = 3
BASE_DELAY = 1.0  # seconds


class LLMRouter:
    """根据模块路由到不同的 LLM Provider，带指数退避重试 + Ollama 离线降级。

    所有配置一律通过 get_settings() 动态读取（lru_cache 单例，配置热更新时
    cache_clear 后即生效），不再在模块加载时固化。
    """

    """
    模块 → 厂商。这里只登记用哪个厂商，具体取值一律走 get_settings()。
    """
    MODULE_PROVIDERS = {
        "proposal": "glm",
        "quotation": "deepseek",
        "document": "deepseek",
        "customer": "glm",
        "product": "deepseek",
        "requirement": "deepseek",
        "default": "deepseek",
    }

    def __init__(self):
        # 复用单个 aiohttp ClientSession，避免每请求新建连接池（丢失 keep-alive）。
        # 懒加载：首次实际请求时才创建。
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    def get_config(self, module: str) -> Dict[str, Any]:
        provider = self.MODULE_PROVIDERS.get(module, self.MODULE_PROVIDERS["default"])
        s = get_settings()
        return {
            "name": provider,
            "api_key": getattr(s, f"{provider}_api_key", ""),
            "model": getattr(s, f"{provider}_model", ""),
            "base_url": getattr(s, f"{provider}_base_url", ""),
        }

    def _get_ollama_config(self) -> Dict[str, Any]:
        s = get_settings()
        return {
            "name": "ollama",
            "api_key": s.ollama_api_key or "ollama",
            "model": s.ollama_model,
            "base_url": s.ollama_base_url,
        }

    def _is_ollama_available(self) -> bool:
        s = get_settings()
        return bool(s.ollama_model and s.ollama_base_url)

    def _resolve_provider(self, module: str) -> Tuple[str, Dict[str, Any]]:
        """解析最终使用的 provider 配置，处理云端 key 缺失 / 出境阻断时的 Ollama 降级。

        返回 (provider_name, config)。若无可降级路径，抛 EgressBlocked 或返回
        带 'missing_key' 标记的配置由调用方处理。
        """
        config = self.get_config(module)
        provider_name = config["name"]
        api_key = config["api_key"]
        base_url = config["base_url"]

        if not api_key:
            # 云端 Key 未配置，降级到 Ollama
            if self._is_ollama_available():
                return "ollama", self._get_ollama_config()
            return provider_name, config  # 调用方会返回"未配置"提示

        try:
            # 带上 provider_name，台账里才看得出是哪家厂商被拦的
            egress.assert_allowed(base_url, module, provider_name)
        except egress.EgressBlocked:
            # 本地模式下被阻断，降级到 Ollama
            if self._is_ollama_available():
                return "ollama", self._get_ollama_config()
            raise

        return provider_name, config

    def _maybe_sanitize(self, messages: list, base_url: str) -> Tuple[list, dict]:
        """出境前脱敏。本地模型不脱敏（数据没离开本机，脱敏只会降低质量）。"""
        if get_settings().egress_sanitize and not egress.is_loopback(base_url):
            return egress.sanitize_messages(messages)
        return messages, {}

    async def chat(self, messages: list, module: str = "default", stream: bool = False, **kwargs) -> str:
        provider_name, config = self._resolve_provider(module)
        api_key = config["api_key"]
        model = config["model"]
        base_url = config["base_url"]

        if not api_key:
            return f"[错误] {provider_name} API Key 未配置"

        # 保留原始（未脱敏）副本给本地 Ollama 降级用：脱敏只该作用于云端出境，
        # 本地模型数据不离机，拿到 [手机号已隐去] 只会无谓降质。
        original_messages = list(messages)
        messages, redactions = self._maybe_sanitize(messages, base_url)
        outbound_chars = sum(len(m.get("content", "") or "") for m in messages)

        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {"model": model, "messages": messages, "stream": stream, **kwargs}

        try:
            result = await self._dispatch(base_url, headers, payload, stream)
        except Exception as exc:
            # 云端调用失败，尝试降级到 Ollama（用原始未脱敏消息）
            if self._is_ollama_available():
                try:
                    return await self._chat_ollama(original_messages, stream, **kwargs)
                except Exception:
                    pass
            egress.record(module, provider_name, base_url, outbound_chars, redactions, "failed", str(exc))
            raise

        egress.record(module, provider_name, base_url, outbound_chars, redactions, "ok")
        return result

    async def _chat_ollama(self, messages: list, stream: bool = False, **kwargs) -> str:
        config = self._get_ollama_config()
        headers = {"Authorization": f"Bearer {config['api_key']}", "Content-Type": "application/json"}
        payload = {"model": config["model"], "messages": messages, "stream": stream, **kwargs}
        result = await self._dispatch(config["base_url"], headers, payload, stream)
        egress.record("ollama", "ollama", config["base_url"], 0, {}, "ok")
        return result

    async def _dispatch(self, base_url: str, headers: dict, payload: dict, stream: bool) -> str:
        """实际发请求，带 429/5xx 与网络错误的指数退避重试，复用共享 session。"""
        last_error = None
        session = await self._get_session()
        for attempt in range(MAX_RETRIES):
            try:
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as response:
                    if response.status == 429 or response.status >= 500:
                        delay = BASE_DELAY * (2 ** attempt)
                        await asyncio.sleep(delay)
                        continue
                    if response.status != 200:
                        text = await response.text()
                        raise Exception(f"LLM API error: {response.status} - {text}")

                    if stream:
                        return await self._handle_stream(response)
                    data = await response.json()
                    return data["choices"][0]["message"]["content"]
            except (aiohttp.ClientError, asyncio.TimeoutError, ConnectionError) as exc:
                last_error = exc
                if attempt < MAX_RETRIES - 1:
                    delay = BASE_DELAY * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise Exception(f"LLM 连接失败（已重试 {MAX_RETRIES} 次）: {last_error}") from exc

        raise Exception(f"LLM 调用失败: {last_error}")

    async def _handle_stream(self, response: aiohttp.ClientResponse) -> str:
        result = []
        async for line in response.content:
            line = line.decode('utf-8').strip()
            if line.startswith('data: '):
                data_str = line[6:]
                if data_str == '[DONE]':
                    break
                try:
                    data = json.loads(data_str)
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    # content 键存在不代表有内容：带思考过程的模型（GLM/DeepSeek 的
                    # reasoning 流）在思考阶段会发 content=null，只把推理放在
                    # reasoning_content 里。只判断 "in delta" 会把 None 也收进来，
                    # 拼接后就是满屏的 "NoneNoneNone…"。
                    piece = delta.get("content")
                    if isinstance(piece, str) and piece:
                        result.append(piece)
                except json.JSONDecodeError:
                    continue
        return "".join(result)

    async def _stream_once(self, config: Dict[str, Any], messages: list, **kwargs):
        """向单个 provider 发起一次流式请求，逐 token 吐出。

        重试只发生在**还没吐出任何 token 之前** —— 一旦开始吐，消费端已经收到
        半截内容，再重来会把前半段重复发一遍。所以拿到 200 并开始读 body 之后
        出的错一律往外抛，由调用方决定怎么收尾。
        """
        session = await self._get_session()
        base_url = config["base_url"]
        headers = {
            "Authorization": f"Bearer {config['api_key']}",
            "Content-Type": "application/json",
        }
        payload = {"model": config["model"], "messages": messages, "stream": True, **kwargs}

        yielded = False
        last_error: Optional[Exception] = None
        for attempt in range(MAX_RETRIES):
            try:
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=120),
                ) as response:
                    if response.status == 429 or response.status >= 500:
                        last_error = Exception(f"LLM API error: {response.status}")
                        if attempt < MAX_RETRIES - 1:
                            await asyncio.sleep(BASE_DELAY * (2 ** attempt))
                            continue
                        raise last_error
                    if response.status != 200:
                        text = await response.text()
                        raise Exception(f"LLM API error: {response.status} - {text[:200]}")

                    async for line in response.content:
                        line = line.decode("utf-8").strip()
                        if not line.startswith("data: "):
                            continue
                        data_str = line[6:]
                        if data_str == "[DONE]":
                            return
                        try:
                            data = json.loads(data_str)
                            delta = data.get("choices", [{}])[0].get("delta", {})
                            # 同 _handle_stream：思考阶段 content 为 null，不能直接下发，
                            # 否则前端会逐字收到 "None" 拼成一整屏。
                            piece = delta.get("content")
                            if isinstance(piece, str) and piece:
                                yielded = True
                                yield piece
                        except json.JSONDecodeError:
                            continue
                    return
            except (aiohttp.ClientError, asyncio.TimeoutError, ConnectionError) as exc:
                last_error = exc
                # 已经吐过内容就不能重试了，直接抛给调用方
                if yielded or attempt >= MAX_RETRIES - 1:
                    raise Exception(f"LLM 连接失败: {exc}") from exc
                await asyncio.sleep(BASE_DELAY * (2 ** attempt))

        if last_error:
            raise last_error

    async def chat_stream(self, messages: list, module: str = "default", **kwargs):
        """流式调用 LLM，逐 token 返回。

        与非流式的 chat() 对齐三件事，此前流式这条路一件都没有：
          1. 重试   —— 429/5xx 与网络错误按指数退避重试（见 _stream_once）
          2. 运行时降级 —— 云端连不上时切 Ollama。注意 _resolve_provider 只做
             **飞行前**降级（没配 key / 出境被拦），云端"当场调用失败"它管不着，
             docstring 原来写"复用降级逻辑"是把这两件事混为一谈了。
          3. 出境审计 —— 原先流式完全不写 egress 台账。这个系统专门做了出境
             记录（/config 会展示 egress.summary()），而最常用的问答走流式，
             等于把最大的一股出境流量漏在账外。
        """
        provider_name, config = self._resolve_provider(module)
        base_url = config["base_url"]

        if not config["api_key"]:
            yield f"[错误] {provider_name} API Key 未配置"
            return

        # 保留原始未脱敏副本：云端出境需脱敏，本地 Ollama 降级时用原文（不离机，
        # 脱敏只会降质，见 chat() 同类修复）。
        original_messages = list(messages)
        messages, redactions = self._maybe_sanitize(messages, base_url)
        outbound_chars = sum(len(m.get("content", "") or "") for m in messages)

        # 首选云端，失败且尚未吐出内容时再试 Ollama
        attempts = [(provider_name, config)]
        if provider_name != "ollama" and self._is_ollama_available():
            attempts.append(("ollama", self._get_ollama_config()))

        last_error: Optional[Exception] = None
        for name, cfg in attempts:
            started = False
            # Ollama 用原始未脱敏消息；云端用脱敏后的
            use_messages = original_messages if name == "ollama" else messages
            try:
                async for piece in self._stream_once(cfg, use_messages, **kwargs):
                    started = True
                    yield piece
            except Exception as exc:
                last_error = exc
                if started:
                    # 半截内容已经发出去了，换 provider 重来只会前后文错乱：
                    # 记一笔 partial 然后如实告诉用户中断了
                    egress.record(
                        module, name, cfg["base_url"], outbound_chars, redactions,
                        "partial", str(exc),
                    )
                    yield f"\n[错误] 生成中断：{str(exc)[:100]}"
                    return
                continue
            egress.record(module, name, cfg["base_url"], outbound_chars, redactions, "ok")
            return

        egress.record(
            module, provider_name, base_url, outbound_chars, redactions,
            "failed", str(last_error),
        )
        yield f"[错误] {str(last_error)[:100]}"

    async def _dispatch_raw(self, base_url: str, headers: dict, payload: dict) -> dict:
        """发请求并返回**完整响应 JSON**（不只 content）。

        _dispatch 只取 choices[0].message.content，工具调用循环要读 tool_calls，
        所以单独一个返回原始 dict 的变体。重试策略与 _dispatch 一致。
        """
        last_error = None
        session = await self._get_session()
        for attempt in range(MAX_RETRIES):
            try:
                async with session.post(
                    f"{base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60),
                ) as response:
                    if response.status == 429 or response.status >= 500:
                        delay = BASE_DELAY * (2 ** attempt)
                        await asyncio.sleep(delay)
                        continue
                    if response.status != 200:
                        text = await response.text()
                        raise Exception(f"LLM API error: {response.status} - {text}")
                    return await response.json()
            except (aiohttp.ClientError, asyncio.TimeoutError, ConnectionError) as exc:
                last_error = exc
                if attempt < MAX_RETRIES - 1:
                    delay = BASE_DELAY * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
                raise Exception(f"LLM 连接失败（已重试 {MAX_RETRIES} 次）: {last_error}") from exc
        raise Exception(f"LLM 调用失败: {last_error}")

    async def chat_with_tools(
        self,
        messages: list,
        module: str = "default",
        tool_schemas: list = None,
        max_rounds: int = 4,
    ) -> dict:
        """GLM-5.2 function calling 调度循环。

        模型收到工具清单后自行决定是否调用；若返回 tool_calls，执行本地 handler 后把
        结果以 role=tool + tool_call_id 回传，循环直至模型不再调工具（给出最终答案）
        或达到轮次上限。

        工具调用固定走 GLM（glm_tool_model，默认 glm-5.2），不复用 module 路由——
        DeepSeek 等其它厂商的工具协议兼容性未验证。未启用 / 未配 Key / 出境阻断 /
        调用失败时，全部降级到普通 chat，保证可用性。

        返回 {"content", "tool_trace", "tools_used", ...}。
        """
        from app.core.tools import exec_tool

        s = get_settings()
        tool_schemas = tool_schemas if tool_schemas is not None else []

        # 任一前置条件不满足 → 退回普通 chat（不破坏调用方）
        if not s.glm_tools_enabled or not s.glm_api_key or not tool_schemas:
            content = await self.chat(messages, module=module)
            return {"content": content, "tool_trace": [], "tools_used": False}

        base_url = s.glm_base_url
        api_key = s.glm_api_key
        model = s.glm_tool_model or s.glm_model

        try:
            egress.assert_allowed(base_url, module)
        except egress.EgressBlocked:
            content = await self.chat(messages, module=module)
            return {"content": content, "tool_trace": [], "tools_used": False, "egress_blocked": True}

        convo, redactions = self._maybe_sanitize(list(messages), base_url)
        outbound_chars = sum(len(m.get("content", "") or "") for m in convo)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}

        tool_trace: list = []
        try:
            for round_i in range(max_rounds):
                payload = {
                    "model": model,
                    "messages": convo,
                    "tools": tool_schemas,
                    "tool_choice": "auto",
                    "stream": False,
                }
                data = await self._dispatch_raw(base_url, headers, payload)
                msg = data["choices"][0]["message"]

                tool_calls = msg.get("tool_calls") or []
                if not tool_calls:
                    # 模型不再调工具 → 给出最终答案
                    egress.record(module, "glm", base_url, outbound_chars, redactions, "ok")
                    return {
                        "content": msg.get("content") or "",
                        "tool_trace": tool_trace,
                        "tools_used": True,
                    }

                # 把带 tool_calls 的 assistant 消息原样追加（必须保留 tool_calls 字段，
                # 否则模型收到的对话历史里"上一轮我让它调了什么"就断了）
                convo.append({
                    "role": "assistant",
                    "content": msg.get("content") or "",
                    "tool_calls": tool_calls,
                })

                # 逐个执行工具，结果以 role=tool 回传
                for tc in tool_calls:
                    fn = tc.get("function", {})
                    name = fn.get("name", "")
                    try:
                        args = json.loads(fn.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {}
                    tool_trace.append({"tool": name, "args": args, "round": round_i + 1})
                    result = await exec_tool(name, args)
                    convo.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id", ""),
                        "content": result,
                    })

            # 轮次用尽仍未收敛
            egress.record(module, "glm", base_url, outbound_chars, redactions, "ok")
            return {
                "content": "（工具调用已达最大轮次，未能给出最终答案，请缩小问题范围后重试。）",
                "tool_trace": tool_trace,
                "tools_used": True,
                "truncated": True,
            }
        except Exception as exc:
            egress.record(module, "glm", base_url, outbound_chars, redactions, "failed", str(exc))
            # 工具链路失败时降级普通 chat，保证对话不中断
            content = await self.chat(messages, module=module)
            return {
                "content": content,
                "tool_trace": tool_trace,
                "tools_used": False,
                "fallback": True,
                "error": str(exc)[:200],
            }

    async def chat_with_web_search(self, messages: list, module: str = "default") -> dict:
        """用 glm_web_search_model + 内置 web_search 工具做一轮联网搜索增强。

        模型自行搜索并把 [来源:ref_x] 整进回答。官方文档仅在 glm-4-air 上示例过
        web_search，glm-5.2 是否支持未明确，故这里独立走 glm_web_search_model
        （默认 glm-4-air），不与 function calling 混用，规避兼容风险。

        返回 {"content", "web_search_used", ...}。
        """
        s = get_settings()
        if not s.glm_web_search_enabled or not s.glm_api_key:
            return {"content": "", "web_search_used": False}

        base_url = s.glm_base_url
        api_key = s.glm_api_key
        model = s.glm_web_search_model or "glm-4-air"

        try:
            egress.assert_allowed(base_url, module)
        except egress.EgressBlocked:
            return {"content": "", "web_search_used": False, "egress_blocked": True}

        convo, redactions = self._maybe_sanitize(list(messages), base_url)
        outbound_chars = sum(len(m.get("content", "") or "") for m in convo)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model,
            "messages": convo,
            "stream": False,
            "tools": [{
                "type": "web_search",
                "web_search": {
                    "enable": True,
                    "search_engine": s.glm_web_search_engine or "search_std",
                    # count 1~50，文档默认 10；这里给个节流的默认 5
                    "count": max(1, min(int(s.glm_web_search_count or 5), 50)),
                },
            }],
        }
        try:
            data = await self._dispatch_raw(base_url, headers, payload)
            content = data["choices"][0]["message"].get("content") or ""
            egress.record(module, "glm", base_url, outbound_chars, redactions, "ok")
            return {"content": content, "web_search_used": True}
        except Exception as exc:
            egress.record(module, "glm", base_url, outbound_chars, redactions, "failed", str(exc))
            return {"content": "", "web_search_used": False, "error": str(exc)[:200]}

    async def chat_structured(
        self,
        messages: list,
        tool_schema: dict,
        module: str = "default",
        temperature: float = 0.1,
    ) -> Optional[dict]:
        """结构化输出：让模型调用指定工具，把工具调用的参数当作结构化结果返回。

        用于需求字段抽取这类"需要严格结构化结果"的场景——比"强制输出 JSON 文本
        + 正则解析"可靠得多（模型原生 function calling 返回的就是结构化 arguments，
        不存在 JSON 语法错误/夹带说明文字的问题）。

        用法：调用方把期望的输出形状定义成一个 tool 的 parameters schema 传进来，
        本方法发请求；若模型调用了该工具，返回 json.loads 后的参数 dict；若模型
        没调工具（回了普通文本），返回 None，由调用方自行降级。

        仅在 glm_tools_enabled 开启时启用；未开启/无 Key/出境阻断/失败均返回 None。
        """
        s = get_settings()
        if not s.glm_tools_enabled or not s.glm_api_key:
            return None

        base_url = s.glm_base_url
        api_key = s.glm_api_key
        model = s.glm_tool_model or s.glm_model

        try:
            egress.assert_allowed(base_url, module)
        except egress.EgressBlocked:
            return None

        convo, redactions = self._maybe_sanitize(list(messages), base_url)
        outbound_chars = sum(len(m.get("content", "") or "") for m in convo)
        headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
        payload = {
            "model": model,
            "messages": convo,
            "tools": [tool_schema],
            "tool_choice": "auto",
            "temperature": temperature,
            "stream": False,
        }
        try:
            data = await self._dispatch_raw(base_url, headers, payload)
            egress.record(module, "glm", base_url, outbound_chars, redactions, "ok")
        except Exception as exc:
            egress.record(module, "glm", base_url, outbound_chars, redactions, "failed", str(exc))
            return None

        msg = data.get("choices", [{}])[0].get("message", {})
        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            return None
        args_str = tool_calls[0].get("function", {}).get("arguments", "{}")
        try:
            return json.loads(args_str)
        except json.JSONDecodeError:
            return None

    async def health_check(self) -> dict:
        """检查各 LLM 提供商的连通性"""
        results = {}
        s = get_settings()
        session = await self._get_session()

        for provider in ["deepseek", "glm", "openai"]:
            api_key = getattr(s, f"{provider}_api_key", "")
            base_url = getattr(s, f"{provider}_base_url", "")
            if api_key:
                try:
                    async with session.get(
                        f"{base_url}/models",
                        headers={"Authorization": f"Bearer {api_key}"},
                        timeout=aiohttp.ClientTimeout(total=5),
                    ) as resp:
                        results[provider] = {"status": "ok" if resp.status == 200 else "error", "code": resp.status}
                except Exception as exc:
                    results[provider] = {"status": "error", "error": str(exc)[:100]}
            else:
                results[provider] = {"status": "not_configured"}

        if self._is_ollama_available():
            try:
                async with session.get(
                    f"{s.ollama_base_url}/models",
                    timeout=aiohttp.ClientTimeout(total=3),
                ) as resp:
                    results["ollama"] = {"status": "ok" if resp.status == 200 else "error", "model": s.ollama_model}
            except Exception as exc:
                results["ollama"] = {"status": "offline", "error": str(exc)[:100]}
        else:
            results["ollama"] = {"status": "not_configured"}

        return results


llm_router = LLMRouter()
