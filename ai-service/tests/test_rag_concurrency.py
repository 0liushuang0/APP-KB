"""检索与写入并发时的一致性。

回归背景：关键词索引的 vectorizer / matrix / ids 三个字段原来是逐个重新赋值的，
而检索侧跨二十多行分别读取。撞上重建就会拿到"分数来自旧矩阵、id 列表已换新"
的组合 —— 下标越界还算好的，不越界就是把分数安到别的 chunk 头上，
返回错误内容且不报错。这条用例在持续写入的同时反复检索，逼出那个窗口。
"""
import os
import sys
import threading
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DIM = 8


class _FakeEmbedding:
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
    # 文案要能过 add_chunks 的可读性校验（looks_like_text 等），
    # 否则整批被当成解析残渣跳过，测试会变成空跑还显示通过。
    return [
        {
            "content": f"{prefix} 内容片段 {i} 关于拉矫机与辊系的技术说明",
            "source_type": "doc",
            "source_id": prefix,
            "document_id": prefix,
        }
        for i in range(n)
    ]


def test_边写边搜不会返回不存在的chunk_id(svc):
    seeded = svc.add_chunks(_chunks("seed", 20))
    # 先确认真的写进去了 —— 内容被质量过滤挡掉的话，下面整段会变成空跑
    assert seeded["indexed"] == 20, seeded

    errors: list = []
    stop = threading.Event()

    def writer():
        try:
            for b in range(12):
                if stop.is_set():
                    return
                svc.add_chunks(_chunks(f"w{b}", 5))
        except Exception as exc:  # noqa: BLE001
            errors.append(("writer", repr(exc)))

    def searcher():
        try:
            for _ in range(60):
                if stop.is_set():
                    return
                hits = svc._bm25_search("拉矫机辊系技术说明", None, 5)
                # 返回的 id 必须都在当前 id 表里 —— 串了就会取到别的代的 id
                known = set(svc._id_map)
                for h in hits:
                    if h["id"] not in known:
                        errors.append(("searcher", f"返回了未知 id: {h['id']}"))
                        return
        except Exception as exc:  # noqa: BLE001
            errors.append(("searcher", repr(exc)))

    threads = [threading.Thread(target=writer)] + [
        threading.Thread(target=searcher) for _ in range(3)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)
    stop.set()

    assert not errors, f"并发下出现不一致：{errors[:3]}"


def test_快照取到的矩阵与id长度一致(svc):
    """三件套必须同代：长度对不上说明换出不是原子的。"""
    assert svc.add_chunks(_chunks("a", 10))["indexed"] == 10

    with svc._bm25_lock:
        matrix = svc._bm25_matrix
        ids = svc._bm25_ids

    assert matrix is not None
    assert matrix.shape[0] == len(ids)
