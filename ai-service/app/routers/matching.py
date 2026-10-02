"""智能匹配引擎路由。

POST /matching/similar    - 多维度相似度搜索（需求/方案/报价）
POST /matching/analyze    - AI分析需求，提取结构化参数
"""
from __future__ import annotations

import json
import logging
import asyncio
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Security, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.rag import rag_service
from app.core.llm_router import llm_router
from app.core.json_utils import extract_json

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class SimilarRequest(BaseModel):
    query: str = Field(..., max_length=50_000)
    source_types: Optional[List[str]] = Field(
        default=None,
        description="筛选来源类型：requirement, proposal, quotation, document",
    )
    top_k: int = Field(default=10, ge=1, le=50)
    customer_id: Optional[str] = Field(default=None, max_length=255)


class AnalyzeRequest(BaseModel):
    title: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=50_000)
    raw_texts: List[str] = Field(default_factory=list)


@router.post("/similar")
async def find_similar(request: SimilarRequest):
    """多维度相似度搜索。

    在向量库中搜索与 query 最相似的历史需求、方案、报价。
    可按 source_types 过滤，可按 customer_id 过滤。
    """
    try:
        # rag_service.search 是 CPU 密集同步调用，丢进线程池避免阻塞事件循环
        results = await asyncio.to_thread(
            rag_service.search,
            query=request.query,
            source_types=request.source_types,
            top_k=request.top_k,
        )

        # 注：原先这里有一段按 customer_id 过滤的循环，但 rag_service.search 返回的
        # 结果只有 source_type/source_id/content/score，并不带 customer_id 字段，
        # 所以 r.get("customer_id") 恒为 None，过滤从未生效（死代码）。
        # 要真正支持按客户过滤，需要在索引侧给每个 chunk 存 customer_id（较大改造），
        # 目前检索层做不到，故移除该误导性过滤，避免给调用方"已过滤"的假象。
        filtered = list(results)

        grouped: Dict[str, List[dict]] = {}
        for r in filtered:
            st = r.get("source_type", "unknown")
            if st not in grouped:
                grouped[st] = []
            grouped[st].append(r)

        return {
            "total": len(filtered),
            "results": filtered,
            "grouped": grouped,
        }
    except Exception as exc:
        logger.exception("matching/similar failed")
        raise HTTPException(status_code=500, detail=f"相似度搜索失败：{exc}")


@router.post("/analyze")
async def analyze_requirement(request: AnalyzeRequest):
    """AI分析需求资料，提取结构化技术参数。

    将非结构化文本转化为 JSON 格式的技术参数表，
    供技术领导审核确认。
    """
    combined_parts = []
    if request.title:
        combined_parts.append(f"需求标题: {request.title}")
    if request.description:
        combined_parts.append(f"需求描述: {request.description}")
    for i, text in enumerate(request.raw_texts):
        combined_parts.append(f"资料{i + 1}: {text[:3000]}")

    combined = "\n\n".join(combined_parts)
    if not combined.strip():
        return {"spec": {}, "summary": "无有效输入", "confidence": 0}

    system_prompt = (
        "你是技术需求分析专家。请从以下资料中提取结构化技术参数。\n"
        "输出 JSON，格式如下：\n"
        "{\n"
        '  "productType": "产品类型（如输送系统、除尘设备等）",\n'
        '  "params": [\n'
        '    {"key": "参数名", "value": "参数值", "unit": "单位", "confidence": 0.0-1.0}\n'
        "  ],\n"
        '  "specialRequirements": ["特殊要求1", "特殊要求2"],\n'
        '  "standards": ["适用标准1", "适用标准2"],\n'
        '  "risisks": ["风险点1", "风险点2"],\n'
        '  "summary": "一段话总结需求核心",\n'
        '  "confidence": 0.0-1.0\n'
        "}\n"
        "只输出 JSON，不要其他文字。"
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": combined[:10000]},
    ]

    try:
        response = await llm_router.chat(
            messages=messages,
            module="document",
            temperature=0.3,
            response_format={"type": "json_object"},
        )
        spec = extract_json(response)

        if not spec or not isinstance(spec, dict):
            return {"spec": {}, "summary": "解析失败", "confidence": 0}

        spec.setdefault("params", [])
        spec.setdefault("specialRequirements", [])
        spec.setdefault("standards", [])
        spec.setdefault("risks", [])
        spec.setdefault("summary", "")
        spec.setdefault("confidence", 0.5)

        return {"spec": spec, "summary": spec.get("summary", ""), "confidence": spec.get("confidence", 0.5)}
    except Exception:
        logger.exception("matching/analyze failed")
        return {"spec": {}, "summary": "AI分析服务暂时不可用", "confidence": 0}


class ParamDiffRequest(BaseModel):
    current: Dict[str, Any] = Field(default_factory=dict)
    historical: Dict[str, Any] = Field(default_factory=dict)


@router.post("/param-diff")
async def param_diff(request: ParamDiffRequest):
    """对比两组技术参数，输出差异。

    输入: { "current": {...}, "historical": {...} }
    输出: { "matches": [...], "differences": [...], "similarity": 0.0-1.0 }
    """
    current = request.current or {}
    historical = request.historical or {}

    cur_params = {p.get("key", ""): p for p in current.get("params", [])} if isinstance(current, dict) else {}
    his_params = {p.get("key", ""): p for p in historical.get("params", [])} if isinstance(historical, dict) else {}

    matches = []
    differences = []

    all_keys = set(cur_params.keys()) | set(his_params.keys())
    for key in all_keys:
        cur = cur_params.get(key)
        his = his_params.get(key)
        if cur and his:
            cur_val = str(cur.get("value", "")).strip().lower()
            his_val = str(his.get("value", "")).strip().lower()
            if cur_val == his_val:
                matches.append({"key": key, "value": cur.get("value"), "unit": cur.get("unit", "")})
            else:
                differences.append({
                    "key": key,
                    "current": cur.get("value", ""),
                    "historical": his.get("value", ""),
                    "unit": cur.get("unit", "") or his.get("unit", ""),
                })
        elif cur and not his:
            differences.append({"key": key, "current": cur.get("value", ""), "historical": "无", "unit": cur.get("unit", "")})
        elif his and not cur:
            differences.append({"key": key, "current": "无", "historical": his.get("value", ""), "unit": his.get("unit", "")})

    total = len(all_keys) if all_keys else 1
    similarity = round(len(matches) / total, 2) if matches else 0.0

    return {
        "matches": matches,
        "differences": differences,
        "similarity": similarity,
        "total_params": len(all_keys),
        "matched_params": len(matches),
    }
