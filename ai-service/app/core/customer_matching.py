"""客户画像相似度匹配服务。

基于向量检索实现：
1. 客户工况相似度匹配
2. 交叉销售推荐
3. 相似客户案例推荐
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


@dataclass
class CustomerProfile:
    """客户画像"""
    customer_id: str
    name: str
    industry: str = ""
    scale: str = ""
    products: list[str] = field(default_factory=list)
    requirements: list[str] = field(default_factory=list)
    working_conditions: dict[str, Any] = field(default_factory=dict)
    purchase_history: list[str] = field(default_factory=list)

    def to_text(self) -> str:
        """转换为文本描述，用于向量化"""
        parts = [
            f"客户名称：{self.name}",
            f"行业：{self.industry}" if self.industry else "",
            f"规模：{self.scale}" if self.scale else "",
            f"产品需求：{', '.join(self.products)}" if self.products else "",
            f"历史需求：{', '.join(self.requirements)}" if self.requirements else "",
        ]

        # 工况信息
        if self.working_conditions:
            wc_parts = []
            for key, value in self.working_conditions.items():
                wc_parts.append(f"{key}:{value}")
            parts.append(f"工况参数：{', '.join(wc_parts)}")

        # 采购历史
        if self.purchase_history:
            parts.append(f"采购历史：{', '.join(self.purchase_history)}")

        return "\n".join([p for p in parts if p])


@dataclass
class SimilarCustomer:
    """相似客户结果"""
    customer_id: str
    name: str
    similarity: float
    match_reasons: list[str]
    cross_sell_opportunities: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "customer_id": self.customer_id,
            "name": self.name,
            "similarity": self.similarity,
            "match_reasons": self.match_reasons,
            "cross_sell_opportunities": self.cross_sell_opportunities,
        }


class CustomerMatchingService:
    """客户匹配服务"""

    def __init__(self):
        self._embedding_service = None
        self._rag_service = None

    @property
    def embedding_service(self):
        if self._embedding_service is None:
            from app.core.embeddings import embedding_service
            self._embedding_service = embedding_service
        return self._embedding_service

    @property
    def rag_service(self):
        if self._rag_service is None:
            from app.core.rag import rag_service
            self._rag_service = rag_service
        return self._rag_service

    async def find_similar_customers(
        self,
        target_customer: CustomerProfile,
        top_k: int = 5,
        min_similarity: float = 0.6,
    ) -> list[SimilarCustomer]:
        """
        查找相似客户

        Args:
            target_customer: 目标客户画像
            top_k: 返回数量
            min_similarity: 最小相似度阈值
        """
        # 将客户画像转换为查询文本
        query_text = target_customer.to_text()

        # 使用 RAG 服务进行向量检索
        try:
            # 搜索相似的客户内容
            # rag_service.search 是同步 CPU 密集调用，裸调会阻塞事件循环
            # （其它路由如 matching.py 都包了 to_thread），这里对齐。
            results = await asyncio.to_thread(
                self.rag_service.search,
                query=query_text,
                source_types=["customer"],  # 只搜索客户类型
                top_k=top_k * 2,  # 多搜索一些，后续过滤
            )

            # 处理结果
            similar_customers = []
            seen_ids = set()

            for result in results:
                source_id = result.get("source_id", "")
                score = result.get("score", 0)

                # 跳过自身和低相似度结果
                if source_id == target_customer.customer_id:
                    continue
                if score < min_similarity:
                    continue
                if source_id in seen_ids:
                    continue

                seen_ids.add(source_id)

                # 解析客户信息
                content = result.get("content", "")
                customer_info = self._parse_customer_content(content)

                # 生成匹配原因
                match_reasons = self._generate_match_reasons(
                    target_customer, customer_info, score
                )

                # 生成交叉销售机会
                cross_sell = self._generate_cross_sell_opportunities(
                    target_customer, customer_info
                )

                similar_customers.append(SimilarCustomer(
                    customer_id=source_id,
                    name=customer_info.get("name", "未知客户"),
                    similarity=score,
                    match_reasons=match_reasons,
                    cross_sell_opportunities=cross_sell,
                ))

            # 按相似度排序并返回 top_k
            similar_customers.sort(key=lambda x: x.similarity, reverse=True)
            return similar_customers[:top_k]

        except Exception as e:
            logger.error(f"Customer matching failed: {e}")
            return []

    def _parse_customer_content(self, content: str) -> dict[str, Any]:
        """解析客户内容"""
        info = {
            "name": "",
            "industry": "",
            "products": [],
            "requirements": [],
        }

        lines = content.split("\n")
        for line in lines:
            line = line.strip()
            if not line:
                continue

            if "客户名称" in line or line.startswith("名称"):
                info["name"] = line.split("：")[-1].split(":")[-1].strip()
            elif "行业" in line:
                info["industry"] = line.split("：")[-1].split(":")[-1].strip()
            elif "产品" in line:
                products = line.split("：")[-1].split(":")[-1].strip()
                info["products"] = [p.strip() for p in products.split(",") if p.strip()]
            elif "需求" in line:
                reqs = line.split("：")[-1].split(":")[-1].strip()
                info["requirements"] = [r.strip() for r in reqs.split(",") if r.strip()]

        return info

    def _generate_match_reasons(
        self,
        target: CustomerProfile,
        matched: dict[str, Any],
        similarity: float,
    ) -> list[str]:
        """生成匹配原因"""
        reasons = []

        # 行业匹配
        if target.industry and matched.get("industry"):
            if target.industry.lower() in matched["industry"].lower():
                reasons.append(f"同行业：{matched['industry']}")

        # 产品匹配
        if target.products and matched.get("products"):
            common_products = set(p.lower() for p in target.products) & \
                            set(p.lower() for p in matched["products"])
            if common_products:
                reasons.append(f"相似产品需求：{', '.join(common_products)}")

        # 需求匹配
        if target.requirements and matched.get("requirements"):
            common_reqs = set(r.lower() for r in target.requirements) & \
                         set(r.lower() for r in matched["requirements"])
            if common_reqs:
                reasons.append(f"相似需求：{', '.join(list(common_reqs)[:3])}")

        # 相似度说明
        if similarity > 0.8:
            reasons.insert(0, "高度相似的工况特征")
        elif similarity > 0.7:
            reasons.insert(0, "相似的工况特征")

        return reasons if reasons else ["综合特征相似"]

    def _generate_cross_sell_opportunities(
        self,
        target: CustomerProfile,
        matched: dict[str, Any],
    ) -> list[str]:
        """生成交叉销售机会"""
        opportunities = []

        # 目标客户有的产品，匹配客户没有
        if target.products and matched.get("products"):
            target_set = set(p.lower() for p in target.products)
            matched_set = set(p.lower() for p in matched["products"])

            # 匹配客户可能需要的产品
            potential = target_set - matched_set
            if potential:
                opportunities.append(
                    f"可推荐产品：{', '.join(list(potential)[:3])}"
                )

        # 基于需求的推荐
        if matched.get("requirements"):
            # 匹配客户有但目标客户没有的需求
            if target.requirements:
                target_reqs = set(r.lower() for r in target.requirements)
                matched_reqs = set(r.lower() for r in matched["requirements"])
                new_reqs = matched_reqs - target_reqs
                if new_reqs:
                    opportunities.append(
                        f"潜在需求扩展：{', '.join(list(new_reqs)[:3])}"
                    )

        return opportunities if opportunities else ["可进一步了解客户需求"]

    async def analyze_cross_sell_potential(
        self,
        customer_id: str,
        purchase_history: list[str],
    ) -> dict[str, Any]:
        """
        分析客户的交叉销售潜力

        Args:
            customer_id: 客户ID
            purchase_history: 采购历史
        """
        # 基于采购历史推荐相关产品
        recommendations = []

        # 产品关联规则（示例）
        product_associations = {
            "液压锁紧装置": ["液压泵站", "液压阀台", "电控系统"],
            "矫直设备": ["开卷机", "收卷机", "液压系统"],
            "剪切设备": ["废边处理系统", "液压系统", "电控柜"],
            "辊涂设备": ["供液系统", "液压系统", "烘干系统"],
            "开收卷设备": ["液压系统", "电控系统", "纠偏系统"],
        }

        purchased_set = set(p.lower() for p in purchase_history)

        for product, related in product_associations.items():
            if product.lower() in purchased_set:
                for r in related:
                    if r.lower() not in purchased_set:
                        recommendations.append({
                            "product": r,
                            "reason": f"与{product}配套使用",
                            "priority": "high",
                        })

        return {
            "customer_id": customer_id,
            "current_products": purchase_history,
            "recommendations": recommendations,
            "total_opportunities": len(recommendations),
        }


# 全局单例
customer_matching_service = CustomerMatchingService()
