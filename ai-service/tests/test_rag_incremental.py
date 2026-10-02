"""向量索引的增量写入。

回归背景：add_chunks 原来每写一批就 _rebuild_index —— 把 vectors 表所有向量
blob 读出来、np.stack、重新归一化、重建整个 FAISS 索引，且全程持 _lock
（检索抢同一把锁，写入期间所有查询被堵住）。改成追加后，这里钉住的是
**追加结果必须与全量重建逐条一致**，否则 _id_map 与索引内向量一旦错位，
检索会张冠李戴地返回别人的内容 —— 那种错很难从结果上看出来。
"""
import os
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DIM = 8


class _FakeEmbedding:
    """内容 → 确定性向量，便于断言检索命中。"""

    @staticmethod
    def _vec(text: str):
        rng = np.random.RandomState(abs(hash(text)) % (2 ** 31))
        return rng.rand(DIM).astype(np.float32).tolist()

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, text):
        return self._vec(text)


@pytest.fixture
def svc(tmp_path, monkeypatch):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    from app.core.config import get_settings
    get_settings.cache_clear()

    from app.core import rag as ragmod
    monkeypatch.setattr(ragmod, "embedding_service", _FakeEmbedding())

    s = ragmod.RAGService()
    s.data_dir = os.path.join(tmp_path, "vectors")
    os.makedirs(s.data_dir, exist_ok=True)
    s.db_path = os.path.join(s.data_dir, "vectors.db")
    s._init_db()
    s._rebuild_index()
    return s


def _chunks(prefix, n):
    return [
        {
            "content": f"{prefix} 内容片段 {i} 关于拉矫机与辊系的技术说明",
            "source_type": "doc",
            "source_id": prefix,
            "document_id": prefix,
        }
        for i in range(n)
    ]


def test_多批追加与全量重建逐条一致(svc):
    svc.add_chunks(_chunks("A", 5))
    svc.add_chunks(_chunks("B", 4))
    svc.add_chunks(_chunks("C", 3))

    assert svc._index.ntotal == 12
    incremental_ids = list(svc._id_map)
    incremental_vecs = svc._index.reconstruct_n(0, svc._index.ntotal).copy()

    svc._rebuild_index()

    assert incremental_ids == list(svc._id_map), "id_map 顺序与全量重建不一致"
    assert np.allclose(
        incremental_vecs, svc._index.reconstruct_n(0, svc._index.ntotal), atol=1e-6
    ), "向量内容与全量重建不一致"


def test_chunk_id不重复(svc):
    svc.add_chunks(_chunks("A", 5))
    svc.add_chunks(_chunks("A", 5))  # 同来源再交一批，序号从库里已有条数接着排
    assert len(set(svc._id_map)) == len(svc._id_map)


def test_检索仍能命中(svc):
    svc.add_chunks(_chunks("A", 3))
    hits = svc.search("A 内容片段 0 关于拉矫机与辊系的技术说明", top_k=3)
    assert hits and hits[0]["content"].startswith("A")


def test_删除走全量重建索引要缩回去(svc):
    svc.add_chunks(_chunks("A", 5))
    svc.add_chunks(_chunks("B", 4))

    svc.delete_by_source("doc", "B")

    assert svc._index.ntotal == 5
    assert all(not i.startswith("doc:B:") for i in svc._id_map)


def test_删除后继续追加仍与重建一致(svc):
    svc.add_chunks(_chunks("A", 5))
    svc.add_chunks(_chunks("B", 4))
    svc.delete_by_source("doc", "B")
    svc.add_chunks(_chunks("D", 2))

    after = list(svc._id_map)
    svc._rebuild_index()
    assert after == list(svc._id_map)


def test_空库首次写入能建起索引(svc):
    """_index 为 None 时追加必须先按新向量维度建索引。"""
    assert svc._index is None or svc._index.ntotal == 0
    svc.add_chunks(_chunks("E", 3))
    assert svc._index.ntotal == 3
    assert svc._dim == DIM
