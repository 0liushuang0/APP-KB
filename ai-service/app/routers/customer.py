"""客户 AI 路由。

POST /ai/customer/profile - 生成客户 AI 画像
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Security
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.json_utils import extract_json
from app.core.llm_router import llm_router

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class CustomerProfileRequest(BaseModel):
    name: str = Field(..., max_length=200)
    industry: Optional[str] = Field(default=None, max_length=200)
    history: Optional[str] = Field(default=None, max_length=20_000)
    requirements: Optional[List[str]] = Field(default=None)
    quotations: Optional[List[Dict[str, Any]]] = Field(default=None)


@router.post("/profile")
async def customer_profile(request: CustomerProfileRequest):
    """根据客户历史需求、报价和沟通记录生成客户画像。"""
    info_lines = [f"客户名称：{request.name}"]
    if request.industry:
        info_lines.append(f"所属行业：{request.industry}")
    if request.history:
        info_lines.append(f"沟通/合作历史：\n{request.history}")
    if request.requirements:
        info_lines.append("历史需求：\n- " + "\n- ".join(request.requirements))
    if request.quotations:
        info_lines.append("历史报价：" + str(request.quotations))

    info_text = "\n".join(info_lines)
    system_prompt = (
        "你是客户分析师，根据客户的历史需求、报价和沟通记录，生成客户画像。"
        "输出JSON: {profile: '一段画像文字', tags: ['价格敏感','技术导向']}"
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": info_text},
    ]

    try:
        response = await llm_router.chat(
            messages=messages,
            module="customer",
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        data = extract_json(response)
        profile = (data.get("profile") or "").strip()
        tags = data.get("tags") or []
        if not isinstance(tags, list):
            tags = [str(tags)]
        if not profile:
            profile = f"{request.name} 暂无足够信息生成完整画像。"
        return {"profile": profile, "tags": tags}
    except Exception:
        logger.exception("customer_profile LLM call failed")
        return {
            "profile": f"{request.name} 画像生成失败，请稍后重试。",
            "tags": [],
        }
