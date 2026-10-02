"""需求结构化引擎路由。

POST /requirement/structure     - 结构化解析需求
POST /requirement/followup-draft - 生成补问草稿
GET  /requirement/templates      - 获取参数模板列表
"""
from __future__ import annotations
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Security
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.requirement_engine.source_parsers import make_chunk
from app.core.requirement_engine.engine import run_engine, gen_followup_draft
from app.core.requirement_engine.requirement_card import RequirementCard
from app.core.requirement_engine.param_templates import TEMPLATES, TEMPLATE_CATEGORIES

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class SourceInput(BaseModel):
    source_id: str = Field(..., max_length=255)
    source_type: str = Field(default="text", max_length=50)
    file_name: str = Field(default="", max_length=255)
    raw_text: str = Field(..., max_length=500_000)


class StructureRequest(BaseModel):
    title: str = Field(default="", max_length=500)
    description: str = Field(default="", max_length=50_000)
    sources: List[SourceInput] = Field(default_factory=list)
    category_override: Optional[str] = Field(default=None, max_length=100)


class FollowupRequest(BaseModel):
    card: Dict[str, Any]
    customer: str = Field(default="客户", max_length=200)


@router.post("/structure")
async def structure_requirement(request: StructureRequest):
    """结构化解析需求，返回需求卡。"""
    chunks = []

    if request.title or request.description:
        main_text = f"{request.title}\n{request.description}".strip()
        if main_text:
            chunks.append(make_chunk(
                source_id="req_main",
                source_type="text",
                file_name="需求主信息",
                raw_text=main_text,
            ))

    for src in request.sources:
        if src.raw_text and src.raw_text.strip():
            chunks.append(make_chunk(
                source_id=src.source_id,
                source_type=src.source_type,
                file_name=src.file_name,
                raw_text=src.raw_text,
            ))

    if not chunks:
        return {"card": RequirementCard().to_dict(), "error": "无有效文本输入"}

    card = await run_engine(chunks)
    # summary = LLM 产出的需求摘要（业务内容）；digest = 一行解析诊断（字段绿黄红、缺失数）
    return {"card": card.to_dict(), "summary": card.summary, "digest": card.summary_line()}


@router.post("/followup-draft")
async def followup_draft(request: FollowupRequest):
    """根据需求卡缺失字段生成补问草稿。"""
    card_data = request.card
    from app.core.requirement_engine.requirement_card import (
        RequirementCard as Card, FieldValue, MissingField
    )
    card = Card(
        product_category=card_data.get("product_category"),
        category_confidence=card_data.get("category_confidence", 0.0),
        overall_confidence=card_data.get("overall_confidence", 0.0),
        notes=card_data.get("notes", ""),
        llm_used=card_data.get("llm_used", False),
    )
    card.fields = [
        FieldValue(
            key=f["key"], label=f["label"], value=f.get("value"),
            unit=f.get("unit"), normalized=f.get("normalized"),
            confidence=f.get("confidence", 0.0),
            evidence=f.get("evidence", []),
            source=f.get("source", "ai"),
        )
        for f in card_data.get("fields", [])
    ]
    card.missing = [
        MissingField(
            field=m["field"], label=m["label"],
            severity=m["severity"], hint=m["hint"],
        )
        for m in card_data.get("missing", [])
    ]

    drafts = gen_followup_draft(card, request.customer)
    return drafts


@router.get("/templates")
async def list_templates():
    """获取可用参数模板列表。"""
    result = []
    for cat in TEMPLATE_CATEGORIES:
        fields = TEMPLATES[cat]
        result.append({
            "category": cat,
            "field_count": len(fields),
            "fields": [f.to_dict() for f in fields],
        })
    return {"templates": result}
