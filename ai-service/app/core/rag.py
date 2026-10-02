import json
import logging
import os
import re
import sqlite3
import threading
import hashlib
from collections import OrderedDict
from typing import Any, Dict, List, Optional

import faiss
import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity as sklearn_cosine_similarity

from app.core.config import settings
from app.core.embeddings import embedding_service
from app.core.parser import (
    is_char_per_line,
    is_index_status_marker,
    is_parse_placeholder,
    looks_like_text,
)
from app.core.reranker import reranker

logger = logging.getLogger(__name__)

# 编号型查询识别：字母打头紧跟数字（SUP-2026-013 / BJ125D / DUJ-9G）。
# 要求字母与数字相邻，"板宽max 1850mm" 这类不会被误判成编号。
_CODE_RE = re.compile(r"[A-Za-z]{2,}[-_]?\d[\w-]*")


class RAGService:
    def __init__(self):
        self.data_dir = os.path.join(settings.data_dir, "vectors")
        os.makedirs(self.data_dir, exist_ok=True)
        self.db_path = os.path.join(self.data_dir, "vectors.db")
        self._lock = threading.Lock()
        # 搜索结果缓存的独立锁。FAISS 检索持 _lock 期间可能耗时，
        # 缓存读写若也复用 _lock 会拖慢并发查询；但缓存本身（OrderedDict）
        # 又不是线程安全的，故单独加一把轻量锁。
        self._cache_lock = threading.Lock()
        self._index: Optional[faiss.IndexFlatIP] = None
        self._id_map: List[str] = []
        self._dim: Optional[int] = None
        # RAG 搜索结果缓存：相同查询 + 相同参数 = 相同结果
        # 避免重复计算 embedding 和 FAISS 搜索
        self._search_cache: OrderedDict[str, List[Dict[str, Any]]] = OrderedDict()
        self._cache_max_size = 256
        self._cache_ttl_seconds = 300  # 5 分钟
        self._cache_timestamps: Dict[str, float] = {}
        # 关键词索引（基于字符 n-gram TF-IDF + 余弦相似度，非概率检索意义上的 BM25，
        # 沿用 _bm25_* 命名仅为兼容历史调用；实际算法见 _build_keyword_index）
        self._bm25_vectorizer: Optional[TfidfVectorizer] = None
        self._bm25_matrix: Optional[Any] = None
        self._bm25_ids: List[str] = []
        # 关键词索引三件套的读写锁。
        #
        # 它们必须被当成一个整体：_build_bm25_index 是逐个重新赋值，而
        # _bm25_search 跨二十多行分别读取。撞上重建时会出现 scores 来自旧矩阵、
        # _bm25_ids 已经换成新列表的组合 —— 下标越界还算好的，不越界就是
        # 把分数安到别的 chunk 头上，静默返回错误内容。
        # 锁只护"整体换出/整体取出"这一瞬间，不覆盖检索计算本身。
        self._bm25_lock = threading.Lock()
        try:
            self._init_db()
            self._load_index()
            self._build_bm25_index()
        except Exception as exc:
            raise RuntimeError(f"Failed to initialize RAG service: {exc}") from exc

    def _init_db(self) -> None:
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS vectors (
                        id TEXT PRIMARY KEY,
                        source_type TEXT NOT NULL,
                        source_id TEXT NOT NULL,
                        document_id TEXT NOT NULL,
                        content TEXT NOT NULL,
                        vector BLOB NOT NULL,
                        permission_snapshot TEXT
                    )
                    """
                )
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_source ON vectors(source_type, source_id)"
                )
                conn.commit()
        except Exception as exc:
            raise RuntimeError(f"Failed to initialize vector database: {exc}") from exc

    def _create_index(self, dim: int) -> faiss.IndexFlatIP:
        try:
            return faiss.IndexFlatIP(dim)
        except Exception as exc:
            raise RuntimeError(f"Failed to create FAISS index: {exc}") from exc

    def _load_index(self) -> None:
        try:
            with sqlite3.connect(self.db_path) as conn:
                rows = conn.execute("SELECT id, vector FROM vectors").fetchall()
            if not rows:
                self._index = None
                self._id_map = []
                self._dim = None
                return

            ids = []
            vectors = []
            for row_id, vec_blob in rows:
                vec = np.frombuffer(vec_blob, dtype=np.float32)
                ids.append(row_id)
                vectors.append(vec)

            dim = len(vectors[0])
            self._dim = dim
            self._id_map = ids
            self._index = self._create_index(dim)

            matrix = np.stack(vectors).astype(np.float32)
            faiss.normalize_L2(matrix)
            self._index.add(matrix)
        except Exception as exc:
            raise RuntimeError(f"Failed to load FAISS index: {exc}") from exc

    def _rebuild_index(self) -> None:
        with self._lock:
            self._load_index()
        self._build_bm25_index()

    def _append_to_index(self, ids: List[str], vectors: np.ndarray) -> None:
        """把新向量追加进内存索引，不重读全库。

        写入路径原来一律走 _rebuild_index —— 每加一个分块就把 vectors 表里所有
        向量 blob 读出来、np.stack、重新归一化、重建整个 FAISS 索引，
        而且全程持 _lock（检索也抢这把锁，于是写入期间所有查询都被堵住）。
        单纯的追加不需要这么干：IndexFlatIP.add 本来就支持往后接。

        注意 _id_map 的下标必须与索引内向量的顺序严格对应，所以 ids 与 vectors
        必须同序，且只包含**真正入库的**那些（去重跳过的不能算）。

        删除路径仍然走全量重建：IndexFlat 没有便宜的按位删除，
        而删除远比写入低频，不值得为它引入 IDMap 包装。
        """
        if not ids:
            return
        with self._lock:
            if self._index is None:
                # 空库首次写入：按新向量的维度建索引
                self._dim = int(vectors.shape[1])
                self._index = self._create_index(self._dim)
                self._id_map = []
            matrix = np.ascontiguousarray(vectors, dtype=np.float32)
            faiss.normalize_L2(matrix)
            self._index.add(matrix)
            self._id_map.extend(ids)

    def add_chunks(self, chunks: List[Dict[str, Any]]) -> Dict[str, int]:
        """写入分块，返回 {"indexed": n, "skipped": n}。

        入库前做可读性校验。这里是所有索引路径的唯一收口（文档上传、
        增量同步 syncObject、全量重建 ReindexService 都打这个方法），
        把关卡设在这里就不会有绕过去的路。

        为什么必须挡：本机实测向量库 2497 块里有 1368 块是解析失败的垃圾
        （Word 二进制标记、编码乱码、逐字符换行的 PDF 残渣），占 55%。
        它们和真资料一起参与排序，挤占送进提示词的 Top-K 名额，
        是回答不准最直接的原因之一。
        """
        try:
            if not chunks:
                return {"indexed": 0, "skipped": 0}

            usable, skipped = [], 0
            for c in chunks:
                content = c.get("content") or ""
                if (
                    looks_like_text(content)
                    and not is_char_per_line(content)
                    and not is_index_status_marker(content)
                    and not is_parse_placeholder(content)
                ):
                    usable.append(c)
                else:
                    skipped += 1
            if skipped:
                logger.warning(
                    "add_chunks 跳过 %d/%d 块无法识别的内容（二进制残留/乱码/逐字换行）",
                    skipped, len(chunks),
                )
            if not usable:
                return {"indexed": 0, "skipped": skipped}
            chunks = usable

            texts = [c["content"] for c in chunks]
            # 入库侧走 embed_documents：不加查询指令前缀（见 embeddings._query_instruction）
            embeddings = embedding_service.embed_documents(texts)
            if not embeddings:
                return {"indexed": 0, "skipped": skipped}

            dim = len(embeddings[0])

            # 与既有索引维度校验：切换 embedding provider（如 basic 768 → local 512）
            # 后继续写入会让 np.stack 在下次 _load_index 时崩溃。这里提前拦截并给出
            # 明确提示，要求先清空向量库。
            if self._dim is not None and dim != self._dim:
                raise ValueError(
                    f"Embedding 维度（{dim}）与既有索引（{self._dim}）不一致。"
                    f"通常是因为切换了 EMBEDDING_PROVIDER。请先调用 delete-by-source "
                    f"或清空 vectors.db 后再重新索引。"
                )

            records = []
            # 与 records 同序，供写库后增量追加进 FAISS（见 _append_to_index）
            new_ids: List[str] = []
            new_vecs: List[np.ndarray] = []

            with sqlite3.connect(self.db_path) as conn:
                existing_rows = conn.execute("SELECT id FROM vectors").fetchall()
                seen_ids = {r[0] for r in existing_rows}

                # 分块序号按 (来源类型, 来源ID) 各自计数，不能用批次内下标：
                # 一次提交多个对象时（全量重建就是这么干的），用批次下标会让
                # 同一对象在不同批次里拿到不同的 chunk_id，去重失效、重复入库。
                #
                # 起始序号要从库里已有的条数接着排：一份大文档会被拆成多批提交
                # （单批上限 100），每批都从 0 重算的话，第 2 批的 id 会与第 1 批
                # 完全重合，被当成重复整批丢弃 —— 表现就是"报了 2181 块，只进了 924"。
                per_source_seq: Dict[tuple, int] = {}
                for row in conn.execute(
                    "SELECT source_type, source_id, COUNT(*) FROM vectors GROUP BY source_type, source_id"
                ).fetchall():
                    per_source_seq[(row[0], str(row[1]))] = row[2]

                for chunk, embedding in zip(chunks, embeddings):
                    source_type = chunk.get("source_type", "unknown")
                    source_id = str(chunk.get("source_id", "unknown"))
                    key = (source_type, source_id)
                    seq = per_source_seq.get(key, 0)
                    per_source_seq[key] = seq + 1
                    chunk_id = f"{source_type}:{source_id}:{seq}"
                    if chunk_id in seen_ids:
                        continue
                    seen_ids.add(chunk_id)

                    vec = np.array(embedding, dtype=np.float32)
                    if vec.shape[0] != dim:
                        raise ValueError(
                            f"Embedding dimension mismatch for chunk {chunk_id}: "
                            f"expected {dim}, got {vec.shape[0]}"
                        )

                    records.append(
                        (
                            chunk_id,
                            source_type,
                            source_id,
                            str(chunk.get("document_id") or source_id),
                            chunk["content"],
                            vec.tobytes(),
                            json.dumps(
                                chunk.get("permission_snapshot") or {},
                                ensure_ascii=False,
                            ),
                        )
                    )
                    new_ids.append(chunk_id)
                    new_vecs.append(vec)

                if records:
                    conn.executemany(
                        """
                        INSERT INTO vectors
                        (id, source_type, source_id, document_id, content, vector, permission_snapshot)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        records,
                    )
                    conn.commit()

            if records:
                # FAISS 走追加；BM25 用的是全库 TF-IDF，词表和 IDF 随语料变化，
                # 只能整体重拟合 —— 这部分仍是 O(N)，是这条路径剩下的成本大头。
                self._append_to_index(new_ids, np.stack(new_vecs))
                self._build_bm25_index()
                self.invalidate_cache()
            return {"indexed": len(records), "skipped": skipped}
        except Exception as exc:
            raise RuntimeError(f"Failed to add chunks: {exc}") from exc

    def search(
        self,
        query: str,
        source_types: Optional[List[str]] = None,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        try:
            top_k = min(top_k, settings.max_top_k)

            # 检查缓存
            cache_key = self._make_cache_key(query, source_types, top_k)
            cached = self._get_cached(cache_key)
            if cached is not None:
                return cached

            query_embedding = embedding_service.embed_query(query)

            with self._lock:
                if self._index is None or self._index.ntotal == 0:
                    return []

                q = np.array(query_embedding, dtype=np.float32).reshape(1, -1)
                if q.shape[1] != self._dim:
                    raise ValueError(
                        f"Query embedding dimension mismatch: expected {self._dim}, got {q.shape[1]}"
                    )
                faiss.normalize_L2(q)

                # Scope must be applied before Top-K. Filtering after a global
                # FAISS search can hide relevant records that fall just outside
                # the unfiltered candidate window.
                if source_types:
                    placeholders = ",".join("?" for _ in source_types)
                    sql = f"""
                        SELECT id, source_type, source_id, document_id, content,
                               vector, permission_snapshot
                        FROM vectors
                        WHERE source_type IN ({placeholders})
                    """
                    with sqlite3.connect(self.db_path) as conn:
                        rows = conn.execute(sql, source_types).fetchall()

                    if not rows:
                        return []

                    vectors = np.stack(
                        [np.frombuffer(row[5], dtype=np.float32) for row in rows]
                    ).astype(np.float32)
                    faiss.normalize_L2(vectors)
                    scores = vectors @ q[0]
                    ranked_positions = np.argsort(scores)[::-1][:top_k]
                    ranked_rows = [rows[int(pos)] for pos in ranked_positions]
                    ranked_scores = [float(scores[int(pos)]) for pos in ranked_positions]
                else:
                    k = min(top_k, self._index.ntotal)
                    distances, indices = self._index.search(q, k)
                    result_ids = [
                        self._id_map[i]
                        for i in indices[0]
                        if 0 <= i < len(self._id_map)
                    ]
                    if not result_ids:
                        return []

                    placeholders = ",".join("?" for _ in result_ids)
                    sql = f"""
                        SELECT id, source_type, source_id, document_id, content,
                               vector, permission_snapshot
                        FROM vectors
                        WHERE id IN ({placeholders})
                    """
                    with sqlite3.connect(self.db_path) as conn:
                        rows = conn.execute(sql, result_ids).fetchall()
                    row_map = {row[0]: row for row in rows}
                    ranked_rows = [row_map[row_id] for row_id in result_ids if row_id in row_map]
                    ranked_scores = [
                        float(distances[0][pos])
                        for pos, row_id in enumerate(result_ids)
                        if row_id in row_map
                    ]

                results = []
                for row, score in zip(ranked_rows, ranked_scores):
                    (
                        _,
                        source_type,
                        source_id,
                        document_id,
                        content,
                        _,
                        raw_snapshot,
                    ) = row
                    try:
                        permission_snapshot = json.loads(raw_snapshot or "{}")
                    except (TypeError, json.JSONDecodeError):
                        permission_snapshot = {}
                    results.append(
                        {
                            "source_type": source_type,
                            "source_id": source_id,
                            "document_id": document_id,
                            "content": content,
                            "score": round(score, 4),
                            "permission_snapshot": permission_snapshot,
                        }
                    )
                # 存入缓存
                self._set_cached(cache_key, results)
                return results
        except Exception as exc:
            raise RuntimeError(f"Failed to search: {exc}") from exc

    def _make_cache_key(self, query: str, source_types: Optional[List[str]], top_k: int) -> str:
        """生成缓存键：查询文本 + 来源类型 + 返回数量的哈希"""
        parts = [query, str(sorted(source_types) if source_types else ""), str(top_k)]
        return hashlib.md5("|".join(parts).encode()).hexdigest()

    def _get_cached(self, key: str) -> Optional[List[Dict[str, Any]]]:
        """从缓存读取，检查 TTL。所有对 OrderedDict 的变更都在 _cache_lock 内完成，
        避免并发请求触发 'OrderedDict mutated during iteration'。"""
        import time
        with self._cache_lock:
            if key not in self._search_cache:
                return None
            ts = self._cache_timestamps.get(key, 0)
            if time.time() - ts > self._cache_ttl_seconds:
                self._search_cache.pop(key, None)
                self._cache_timestamps.pop(key, None)
                return None
            # 移到末尾（LRU）
            self._search_cache.move_to_end(key)
            return self._search_cache[key]

    def _set_cached(self, key: str, value: List[Dict[str, Any]]) -> None:
        """写入缓存，超过容量淘汰最旧的"""
        import time
        with self._cache_lock:
            self._search_cache[key] = value
            self._cache_timestamps[key] = time.time()
            self._search_cache.move_to_end(key)
            while len(self._search_cache) > self._cache_max_size:
                oldest_key, _ = self._search_cache.popitem(last=False)
                self._cache_timestamps.pop(oldest_key, None)

    def invalidate_cache(self) -> None:
        """索引变更时清空缓存"""
        with self._cache_lock:
            self._search_cache.clear()
            self._cache_timestamps.clear()

    def delete_by_source(self, source_type: str, source_id: str) -> None:
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    "DELETE FROM vectors WHERE source_type = ? AND source_id = ?",
                    (source_type, str(source_id)),
                )
                conn.commit()
            # _rebuild_index 内部已重建关键词索引，无需再单独调一次
            self._rebuild_index()
            self.invalidate_cache()
        except Exception as exc:
            raise RuntimeError(f"Failed to delete by source: {exc}") from exc

    def purge_source_type(self, source_type: str) -> int:
        """清空某一类的全部向量，返回删除条数。

        全量重建前必须先清空：只 upsert 不删除的话，库里已删除对象的向量会永远
        留着（本机产品类就有 11 条这样的幽灵数据，检索时仍会被召回）。
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cur = conn.execute(
                    "DELETE FROM vectors WHERE source_type = ?", (source_type,)
                )
                deleted = cur.rowcount or 0
                conn.commit()
            self._rebuild_index()
            self.invalidate_cache()
            return deleted
        except Exception as exc:
            raise RuntimeError(f"Failed to purge source type: {exc}") from exc

    def purge_all(self) -> int:
        """清空全部向量并重建索引，返回删除条数。

        切换 embedding 模型时调用：旧向量与新 embedding 维度不一致，留着会导致
        search 报维度不匹配 / _vector_search 返空。清空后用户可从后端重新索引
        （文档原文在后端 documents 表，不在此处丢失）。
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                cur = conn.execute("DELETE FROM vectors")
                deleted = cur.rowcount or 0
                conn.commit()
            self._rebuild_index()
            self.invalidate_cache()
            return deleted
        except Exception as exc:
            raise RuntimeError(f"Failed to purge all vectors: {exc}") from exc

    def stats(self) -> Dict[str, Any]:
        """按 source_type 汇总已索引的分块数与对象数。

        后端据此和业务表的实际条数做比对，算出"索引覆盖率"——
        此前没有任何地方能看出向量库缺了多少，数据是悄悄少的。
        """
        try:
            with sqlite3.connect(self.db_path) as conn:
                rows = conn.execute(
                    """
                    SELECT source_type, COUNT(*), COUNT(DISTINCT source_id)
                    FROM vectors GROUP BY source_type
                    """
                ).fetchall()
            by_type = {
                row[0]: {"chunks": row[1], "objects": row[2]} for row in rows
            }
            return {
                "by_source_type": by_type,
                "total_chunks": sum(v["chunks"] for v in by_type.values()),
                "total_objects": sum(v["objects"] for v in by_type.values()),
            }
        except Exception as exc:
            raise RuntimeError(f"Failed to read stats: {exc}") from exc

    # ── BM25 索引 ──────────────────────────────────────────────

    def _build_bm25_index(self) -> None:
        """构建关键词索引（字符 n-gram TF-IDF + 余弦相似度），与 FAISS 索引同步重建。

        命名沿用 _bm25_* 是历史遗留：实际并非概率检索意义上的 BM25
        （BM25 需文档长度归一化与词频饱和），这里用 TfidfVectorizer 做的是
        字符级 n-gram 的向量空间模型。对中文短文本召回足够，且无需分词。
        """
        # 先全部算在局部变量里，最后一次性换出（见 _bm25_lock 的说明）：
        # 中途就往 self 上写的话，正在检索的线程会读到半新半旧的组合。
        try:
            with sqlite3.connect(self.db_path) as conn:
                rows = conn.execute("SELECT id, content FROM vectors").fetchall()
            if not rows:
                vectorizer, matrix, ids = None, None, []
            else:
                ids = [row[0] for row in rows]
                contents = [row[1] for row in rows]
                vectorizer = TfidfVectorizer(
                    analyzer="char_wb",
                    ngram_range=(2, 4),
                    max_features=50000,
                )
                matrix = vectorizer.fit_transform(contents)
        except Exception:
            vectorizer, matrix, ids = None, None, []

        with self._bm25_lock:
            self._bm25_vectorizer = vectorizer
            self._bm25_matrix = matrix
            self._bm25_ids = ids

    def hybrid_search(
        self,
        query: str,
        source_types: Optional[List[str]] = None,
        top_k: int = 5,
        vector_weight: Optional[float] = None,
        bm25_weight: Optional[float] = None,
        min_vector_score: Optional[float] = None,
        min_bm25_score: Optional[float] = None,
    ) -> List[Dict[str, Any]]:
        """混合检索：向量 + 关键词 + 精确串，三路加权融合。

        权重按查询形态自适应（vector_weight/bm25_weight 传了就用传入值）：

          · 编号型查询（SUP-2026-013、BJ125D）—— 这种串在语义空间里没有意义，
            向量侧给出的是近乎随机的分；让它占 0.7 权重只会把关键词侧找对的
            结果压下去。实测固定 0.7/0.3 时 SUP-2026-013 直接掉出前三。
          · 自然语言查询 —— 反过来，向量侧才是主力，关键词侧容易被高频字带偏。

        第三路"精确串匹配"专治连号单据：关键词侧是字符 n-gram TF-IDF，
        REQ-2026-001/002/003 的 n-gram 几乎完全重合（只差末位一个数字），
        天然区分不开。而"报个编号查单据"是业务上最高频、最不该错的查询。

        本机 16 条基准查询实测（bge-small）：
            固定 0.7/0.3      hit@1 10/16  hit@3 13/16  MRR 0.708
            自适应            hit@1 13/16  hit@3 15/16  MRR 0.875
            自适应 + 精确串    hit@1 14/16  hit@3 16/16  MRR 0.938
        """
        try:
            top_k = min(top_k, settings.max_top_k)
            # 候选数量扩大以提高召回率
            candidate_k = min(top_k * 3, settings.max_top_k)

            is_code_query = bool(_CODE_RE.search(query))
            if vector_weight is None or bm25_weight is None:
                vector_weight, bm25_weight = (0.2, 0.3) if is_code_query else (0.8, 0.2)
            exact_weight = 1.0 if is_code_query else 0.0

            # 向量检索
            vector_results = self._vector_search(query, source_types, candidate_k)

            # BM25 检索
            bm25_results = self._bm25_search(query, source_types, candidate_k)

            # 精确串检索（仅编号型查询）
            exact_ids = (
                self._exact_search(query, source_types, candidate_k) if is_code_query else set()
            )

            # 合并去重（以 chunk 的唯一主键 id 为键）
            all_ids = set(exact_ids)
            vector_scores: Dict[str, float] = {}
            bm25_scores: Dict[str, float] = {}

            for r in vector_results:
                rid = r["id"]
                all_ids.add(rid)
                vector_scores[rid] = r["score"]

            for r in bm25_results:
                rid = r["id"]
                all_ids.add(rid)
                bm25_scores[rid] = r["score"]

            # chunk id 形如 "{source_type}:{source_id}:{seq}"（见 add_chunks），
            # 去掉末段序号就得到"这块属于哪个对象"，用于后面按对象去重。
            # 从 id 直接推导，省一次回表。
            id_owner: Dict[str, str] = {cid: cid.rsplit(":", 1)[0] for cid in all_ids}

            # 归一化（min-max，避免负分翻转）
            vec_vals = list(vector_scores.values())
            bm25_vals = list(bm25_scores.values())

            def _normalizer(vals: List[float]):
                """返回一个把该路原始分映射到 [0,1] 的函数。

                所有候选同分（**包括只命中一条**）时不能做 min-max —— 分母为 0 会
                直接 ZeroDivisionError，把整次检索打成 500。BM25 侧经常只命中一条，
                这条路走得相当频繁。
                这种情况下它们在本路检索里并列第一，统一给 1.0；给 0.0 会把
                "唯一命中"白白抹掉，等于这一路没投票。
                """
                if not vals:
                    return lambda _v: 0.0
                lo, hi = min(vals), max(vals)
                span = hi - lo
                if span < 1e-9:
                    return lambda _v: 1.0
                return lambda v: (v - lo) / span

            norm_vec = _normalizer(vec_vals)
            norm_bm25 = _normalizer(bm25_vals)

            # 加权融合
            combined: List[Dict[str, Any]] = []
            for sid in all_ids:
                raw_v = vector_scores.get(sid)
                raw_b = bm25_scores.get(sid)
                vs = norm_vec(raw_v) if raw_v is not None else 0.0
                bs = norm_bm25(raw_b) if raw_b is not None else 0.0
                es = 1.0 if sid in exact_ids else 0.0
                combined_score = (
                    vector_weight * vs + bm25_weight * bs + exact_weight * es
                )
                combined.append({"id": sid, "score": combined_score})

            combined.sort(key=lambda x: x["score"], reverse=True)

            # ── 相关度门槛 ──────────────────────────────────────
            #
            # 必须用**原始**分数判断，不能用上面融合出来的 combined_score：
            # 后者经过 min-max 归一化，是相对候选集的排名信号，top1 永远接近 1.0。
            # 问一句库里根本没有的话（"停车场在几楼"），照样能返回三条"高分"结果，
            # 提示词又要求模型"只能基于参考资料回答"，模型于是拿着三条无关资料硬答。
            #
            # 三条通道满足其一即视为相关：
            #   · 向量余弦够高      —— 语义相关
            #   · BM25 够高        —— 字面强命中（罕见专名的向量分会偏低）
            #   · 精确串命中        —— 报了编号，定义上就是要这条
            vmin = settings.min_vector_score if min_vector_score is None else min_vector_score
            bmin = settings.min_bm25_score if min_bm25_score is None else min_bm25_score

            def _relevant(cid: str) -> bool:
                if cid in exact_ids:
                    return True
                if vector_scores.get(cid, -1.0) >= vmin:
                    return True
                return bm25_scores.get(cid, -1.0) >= bmin

            relevant = [c for c in combined if _relevant(c["id"])]
            if not relevant:
                return []

            # ── 取回内容 ────────────────────────────────────────
            #
            # 重排序要读正文，所以回表必须提前到"选定 Top-K 之前"。
            # 只取通过门槛的前 N 条（N = rerank_candidates），不是全部候选 ——
            # 交叉编码器每条都要跑一次推理，候选数直接决定延迟。
            # 关闭重排时不能缩小候选池：后面的按对象去重会丢弃同源的多余分块，
            # 池子截小了可能凑不满 top_k（极端情况下 30 个候选全来自 3 个对象，
            # 去重后只剩 6 条，而 relevant 里其实还有别的对象在排队）。
            # 开启重排时才按 rerank_candidates 限流 —— 交叉编码器逐条推理，
            # 候选数直接决定延迟。
            pool = (
                relevant[: max(top_k, settings.rerank_candidates)]
                if reranker.enabled
                else relevant
            )
            pool_ids = [c["id"] for c in pool]
            if not pool_ids:
                return []

            placeholders = ",".join("?" for _ in pool_ids)
            sql = f"""
                SELECT id, source_type, source_id, document_id, content,
                       vector, permission_snapshot
                FROM vectors
                WHERE id IN ({placeholders})
            """
            with sqlite3.connect(self.db_path) as conn:
                rows = conn.execute(sql, pool_ids).fetchall()
            row_map: Dict[str, Any] = {row[0]: row for row in rows}

            score_map = {c["id"]: c["score"] for c in combined}
            enriched: List[Dict[str, Any]] = []
            for cid in pool_ids:
                row = row_map.get(cid)
                if row is None:
                    continue
                try:
                    permission_snapshot = json.loads(row[6] or "{}")
                except (TypeError, json.JSONDecodeError):
                    permission_snapshot = {}
                enriched.append({
                    "id": cid,
                    "source_type": row[1],
                    "source_id": row[2],
                    "document_id": row[3],
                    "content": row[4],
                    "score": round(score_map.get(cid, 0), 4),
                    "permission_snapshot": permission_snapshot,
                })

            # ── 重排序 ──────────────────────────────────────────
            #
            # 放在去重**之前**：先让交叉编码器把整池候选排准，再每个对象取最好的几块。
            # 反过来（先去重再重排）等于用粗排的结果决定了每个对象拿哪一块出来，
            # 重排只能在已经选残的集合里打转。
            # 未启用或模型不可用时原样返回，不影响主流程。
            enriched, _did_rerank = reranker.rerank(query, enriched, len(enriched))

            # ── 按对象去重 ──────────────────────────────────────
            #
            # 同一份文档的相邻分块内容高度重叠（chunk_overlap=100），
            # 让它们占满 Top-K 等于把上下文窗口浪费在同一段话上，
            # 别的对象一条也进不来。每个对象最多留 N 块。
            per_object = max(1, settings.max_chunks_per_object)
            seen_per_object: Dict[str, int] = {}
            results: List[Dict[str, Any]] = []
            for item in enriched:
                owner = id_owner.get(item["id"], item["id"])
                used = seen_per_object.get(owner, 0)
                if used >= per_object:
                    continue
                seen_per_object[owner] = used + 1
                results.append({k: v for k, v in item.items() if k != "id"})
                if len(results) >= top_k:
                    break

            return results
        except Exception as exc:
            raise RuntimeError(f"Failed to hybrid search: {exc}") from exc

    def _vector_search(self, query: str, source_types: Optional[List[str]], top_k: int) -> List[Dict[str, Any]]:
        """纯向量检索，返回 chunk id（vectors.id 主键）+ score。

        两条分支必须返回同一种标识——即向量行的唯一主键 `id`（chunk_id）。
        之前无 source_types 分支误把 _id_map（chunk_id）命名为 source_id，
        而 source_types 分支又返回真正的 source_id 列，导致 hybrid_search 合并
        与回查 SQL 全部错位。这里统一用 id 贯穿。
        """
        try:
            query_embedding = embedding_service.embed_query(query)
            with self._lock:
                if self._index is None or self._index.ntotal == 0:
                    return []

                q = np.array(query_embedding, dtype=np.float32).reshape(1, -1)
                if q.shape[1] != self._dim:
                    return []
                faiss.normalize_L2(q)

                if source_types:
                    placeholders = ",".join("?" for _ in source_types)
                    sql = f"""
                        SELECT id, source_type, source_id, document_id, content,
                               vector, permission_snapshot
                        FROM vectors
                        WHERE source_type IN ({placeholders})
                    """
                    with sqlite3.connect(self.db_path) as conn:
                        rows = conn.execute(sql, source_types).fetchall()

                    if not rows:
                        return []

                    vectors = np.stack(
                        [np.frombuffer(row[5], dtype=np.float32) for row in rows]
                    ).astype(np.float32)
                    faiss.normalize_L2(vectors)
                    scores = vectors @ q[0]
                    ranked_positions = np.argsort(scores)[::-1][:top_k]
                    return [{"id": rows[int(pos)][0], "score": float(scores[int(pos)])} for pos in ranked_positions]
                else:
                    k = min(top_k, self._index.ntotal)
                    distances, indices = self._index.search(q, k)
                    results = []
                    for i, dist in zip(indices[0], distances[0]):
                        if 0 <= i < len(self._id_map):
                            results.append({"id": self._id_map[i], "score": float(dist)})
                    return results
        except Exception:
            return []

    def _exact_search(
        self, query: str, source_types: Optional[List[str]], top_k: int
    ) -> set:
        """编号型 token 的子串精确匹配，返回命中的 chunk id 集合。

        只在查询里含编号形态的 token 时调用。代价是一次 LIKE 查询，
        换来的是"按单号/型号查记录"这类查询的确定性命中 ——
        字符 n-gram 在连号单据上区分不开（REQ-2026-001 vs -002），
        而这恰恰是用户最不能接受出错的一类。
        """
        codes = _CODE_RE.findall(query)
        if not codes:
            return set()

        hits: set = set()
        try:
            with sqlite3.connect(self.db_path) as conn:
                for code in codes[:5]:  # 防御性上限，正常查询不会有这么多编号
                    sql = "SELECT id FROM vectors WHERE content LIKE ?"
                    args: List[Any] = [f"%{code}%"]
                    if source_types:
                        placeholders = ",".join("?" for _ in source_types)
                        sql += f" AND source_type IN ({placeholders})"
                        args.extend(source_types)
                    sql += " LIMIT ?"
                    args.append(top_k)
                    hits.update(row[0] for row in conn.execute(sql, args))
        except Exception:
            return set()
        return hits

    def _bm25_search(self, query: str, source_types: Optional[List[str]], top_k: int) -> List[Dict[str, Any]]:
        """BM25 关键词检索"""
        try:
            # 一次性取快照：矩阵与 id 列表必须来自同一代索引，
            # 之后整段只用局部变量，哪怕期间发生重建也不会串。
            with self._bm25_lock:
                vectorizer = self._bm25_vectorizer
                matrix = self._bm25_matrix
                ids = self._bm25_ids

            if vectorizer is None or matrix is None:
                return []

            query_vec = vectorizer.transform([query])
            scores = sklearn_cosine_similarity(query_vec, matrix).flatten()

            # 按 source_types 过滤
            if source_types:
                with sqlite3.connect(self.db_path) as conn:
                    placeholders = ",".join("?" for _ in source_types)
                    rows = conn.execute(
                        f"SELECT id, source_type FROM vectors WHERE source_type IN ({placeholders})",
                        source_types,
                    ).fetchall()
                valid_ids = {row[0] for row in rows}
                filtered = [
                    (i, scores[i])
                    for i in range(len(ids))
                    if ids[i] in valid_ids
                ]
            else:
                filtered = list(enumerate(scores))

            filtered.sort(key=lambda x: x[1], reverse=True)
            results = []
            for idx, score in filtered[:top_k]:
                if score > 0:
                    results.append({"id": ids[idx], "score": float(score)})
            return results
        except Exception:
            return []


rag_service = RAGService()
