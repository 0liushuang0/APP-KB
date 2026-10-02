"""多源解析器：把文本/附件转成统一 SourceChunk。

生产环境由后端发送已解析文本，AI 服务不再做文件 I/O。
"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class SourceChunk:
    """统一中间表示。"""
    source_id: str
    source_type: str
    file_name: str
    raw_text: str
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "source_id": self.source_id,
            "source_type": self.source_type,
            "file_name": self.file_name,
            "raw_text": self.raw_text,
            "metadata": self.metadata,
        }


def make_chunk(source_id: str, source_type: str, file_name: str,
               raw_text: str, metadata: dict | None = None) -> SourceChunk:
    """从文本直接构造 SourceChunk。"""
    return SourceChunk(
        source_id=source_id,
        source_type=source_type,
        file_name=file_name,
        raw_text=raw_text.strip(),
        metadata=metadata or {},
    )
