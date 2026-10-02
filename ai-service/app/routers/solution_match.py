"""方案 AI 路由。

POST /ai/solutions/match-explanation - 方案匹配理由
POST /ai/solutions/compare           - 多方案对比
"""
from __future__ import annotations

import json
import logging
from typing import Any, Dict, List

from fastapi import APIRouter, Security
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.json_utils import extract_json
from app.core.llm_router import llm_router

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class MatchExplanationRequest(BaseModel):
    requirement: Dict[str, Any]
    solution: Dict[str, Any]


class CompareRequest(BaseModel):
    solutions: List[Dict[str, Any]] = Field(..., min_length=1)


@router.post("/match-explanation")
async def match_explanation(request: MatchExplanationRequest):
    """解释某方案为何匹配该需求：3 个推荐亮点 + 3 个风险/关注点。"""
    system_prompt = (
        "你是售前方案顾问。对比「客户需求」与「推荐方案」，输出 JSON："
        "{\"highlights\": ['推荐理由1','推荐理由2','推荐理由3'],"
        " \"risks\": ['关注点1','关注点2','关注点3']}。"
        "highlights 与 risks 各给 3 条，简洁专业。"
    )
    user_content = (
        f"客户需求：\n{json.dumps(request.requirement, ensure_ascii=False)}\n\n"
        f"推荐方案：\n{json.dumps(request.solution, ensure_ascii=False)}"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    try:
        response = await llm_router.chat(
            messages=messages,
            module="proposal",
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        data = extract_json(response)
        highlights = data.get("highlights") or []
        risks = data.get("risks") or []
        if not isinstance(highlights, list):
            highlights = [str(highlights)]
        if not isinstance(risks, list):
            risks = [str(risks)]
        return {"highlights": highlights, "risks": risks}
    except Exception:
        logger.exception("match_explanation LLM call failed")
        return {"highlights": [], "risks": ["方案分析服务暂时不可用，请稍后重试。"]}


@router.post("/compare")
async def compare_solutions(request: CompareRequest):
    """对多个方案进行横向对比，生成差异摘要。"""
    system_prompt = (
        "你是售前方案顾问。请横向对比给定的多个方案，从适用场景、核心能力、"
        "价格、交付周期、风险等维度总结差异。"
        "输出 JSON: {\"summary\": '一段对比摘要文字'}。"
    )
    user_content = "待对比方案列表：\n" + json.dumps(
        request.solutions, ensure_ascii=False
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]

    try:
        response = await llm_router.chat(
            messages=messages,
            module="proposal",
            temperature=0.5,
            response_format={"type": "json_object"},
        )
        data = extract_json(response)
        summary = (data.get("summary") or "").strip()
        if not summary:
            summary = "方案对比摘要生成失败，请稍后重试。"
        return {"summary": summary}
    except Exception:
        logger.exception("compare_solutions LLM call failed")
        return {"summary": "方案对比服务暂时不可用，请稍后重试。"}
