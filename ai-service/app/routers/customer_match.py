"""客户匹配 API 路由。

POST /ai/customers/similar - 查找相似客户
POST /ai/customers/cross-sell - 交叉销售分析
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Security, HTTPException
from pydantic import BaseModel, Field

from app.core.auth import verify_api_key
from app.core.customer_matching import (
    CustomerProfile,
    customer_matching_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(dependencies=[Security(verify_api_key)])


class SimilarCustomersRequest(BaseModel):
    customer_id: str = Field(..., max_length=100, description="客户ID")
    name: str = Field(..., max_length=200, description="客户名称")
    industry: str = Field(default="", max_length=100, description="行业")
    scale: str = Field(default="", max_length=50, description="规模")
    products: List[str] = Field(default_factory=list, description="产品需求列表")
    requirements: List[str] = Field(default_factory=list, description="需求列表")
    working_conditions: Dict[str, Any] = Field(default_factory=dict, description="工况参数")
    purchase_history: List[str] = Field(default_factory=list, description="采购历史")
    top_k: int = Field(default=5, ge=1, le=20, description="返回数量")
    min_similarity: float = Field(default=0.6, ge=0, le=1, description="最小相似度")


class CrossSellRequest(BaseModel):
    customer_id: str = Field(..., max_length=100, description="客户ID")
    purchase_history: List[str] = Field(..., min_length=1, description="采购历史")


@router.post("/similar")
async def find_similar_customers(request: SimilarCustomersRequest):
    """查找相似客户，返回相似度匹配结果和交叉销售机会"""
    try:
        # 构建客户画像
        profile = CustomerProfile(
            customer_id=request.customer_id,
            name=request.name,
            industry=request.industry,
            scale=request.scale,
            products=request.products,
            requirements=request.requirements,
            working_conditions=request.working_conditions,
            purchase_history=request.purchase_history,
        )

        # 查找相似客户
        results = await customer_matching_service.find_similar_customers(
            target_customer=profile,
            top_k=request.top_k,
            min_similarity=request.min_similarity,
        )

        return {
            "customer_id": request.customer_id,
            "similar_customers": [r.to_dict() for r in results],
            "total": len(results),
        }

    except Exception as e:
        logger.error(f"Find similar customers failed: {e}")
        raise HTTPException(status_code=500, detail=f"查找相似客户失败：{str(e)}")


@router.post("/cross-sell")
async def analyze_cross_sell(request: CrossSellRequest):
    """分析交叉销售潜力"""
    try:
        results = await customer_matching_service.analyze_cross_sell_potential(
            customer_id=request.customer_id,
            purchase_history=request.purchase_history,
        )
        return results

    except Exception as e:
        logger.error(f"Cross-sell analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"交叉销售分析失败：{str(e)}")
