"""交叉编码器重排序。

向量检索是"双塔"的：query 和文档各自独立编码成向量，再比余弦。
两边在编码时看不到对方，所以只能捕捉粗粒度的语义接近，
分不清"这家供应商做气动"和"这家供应商不做气动"这种细微但决定性的差别。

交叉编码器把 (query, 文档) 拼成一条输入一起过模型，能看到词与词之间的交互，
相关性判断精确得多。代价是每个候选都要跑一次推理 —— 所以它只用于
"召回之后的少量候选重新排序"，不能用来做检索本身。

设计约束：
  · 懒加载 —— 配置没开就一点资源都不占（模型约 400MB 常驻内存）
  · 失败降级 —— 模型缺失/加载失败时返回原顺序，绝不让检索整个挂掉
  · 线程安全 —— 检索走 asyncio.to_thread，可能并发进来
"""

from __future__ import annotations

import logging
import threading
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class Reranker:
    def __init__(self) -> None:
        self._model = None
        self._cached_key: Optional[str] = None
        self._lock = threading.Lock()
        # 加载失败过一次就不再反复重试：每次查询都去 import 一遍
        # sentence_transformers 再失败，只会把每次检索都拖慢几百毫秒。
        self._failed_key: Optional[str] = None

    @property
    def enabled(self) -> bool:
        return bool(get_settings().rerank_enabled)

    def _get_model(self):
        s = get_settings()
        key = s.rerank_model
        if self._model is not None and self._cached_key == key:
            return self._model
        if self._failed_key == key:
            return None

        with self._lock:
            # 双重检查：等锁期间可能已被别的线程加载好
            if self._model is not None and self._cached_key == key:
                return self._model
            if self._failed_key == key:
                return None
            try:
                from sentence_transformers import CrossEncoder

                logger.info("加载重排序模型 %s …", key)
                self._model = CrossEncoder(key)
                self._cached_key = key
                logger.info("重排序模型就绪：%s", key)
            except Exception as exc:
                self._failed_key = key
                logger.warning(
                    "重排序模型加载失败（%s），本次起跳过重排，检索仍按原顺序返回：%s",
                    key, exc,
                )
                return None
        return self._model

    def warmup(self) -> None:
        """启动时预热，避免第一个用户承担模型加载耗时。"""
        if not self.enabled:
            return
        model = self._get_model()
        if model is not None:
            try:
                model.predict([("预热", "预热文本")])
            except Exception:
                logger.warning("重排序预热失败，将在首次调用时重试", exc_info=True)

    def rerank(
        self, query: str, candidates: List[Dict[str, Any]], top_k: int
    ) -> Tuple[List[Dict[str, Any]], bool]:
        """对候选重新排序，返回 (排序后的候选, 是否真的重排了)。

        candidates 每项需含 "content"。返回时给每项写上 rerank_score，
        并保留原有字段（score 仍是融合分，便于对照）。

        任何异常都退回原顺序 —— 重排是锦上添花，不能成为新的故障点。
        """
        if not self.enabled or len(candidates) < 2:
            return candidates[:top_k], False

        model = self._get_model()
        if model is None:
            return candidates[:top_k], False

        try:
            pairs = [(query, c.get("content", "") or "") for c in candidates]
            scores = model.predict(pairs)
            for c, s in zip(candidates, scores):
                c["rerank_score"] = float(s)
            ordered = sorted(
                candidates, key=lambda c: c.get("rerank_score", 0.0), reverse=True
            )
            return ordered[:top_k], True
        except Exception:
            logger.warning("重排序执行失败，退回原顺序", exc_info=True)
            return candidates[:top_k], False


reranker = Reranker()
