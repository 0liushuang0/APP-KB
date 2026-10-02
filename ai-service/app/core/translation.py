"""多语言翻译服务。

使用 LLM 实现文本翻译和双语对照输出。
支持：中→英、英→中、中→日、中→韩 等多语言互译。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)


@dataclass
class TranslationResult:
    """翻译结果"""
    source_lang: str
    target_lang: str
    source_text: str
    translated_text: str
    bilingual_text: str  # 双语对照格式
    confidence: float = 0.0
    segments: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_lang": self.source_lang,
            "target_lang": self.target_lang,
            "source_text": self.source_text,
            "translated_text": self.translated_text,
            "bilingual_text": self.bilingual_text,
            "confidence": self.confidence,
            "segments": self.segments,
        }


# 语言代码映射
LANG_MAP = {
    "zh": "中文",
    "en": "English",
    "ja": "日本語",
    "ko": "한국어",
    "de": "Deutsch",
    "fr": "Français",
    "es": "Español",
    "ru": "Русский",
    "ar": "العربية",
    "pt": "Português",
}

# 语言别名
LANG_ALIASES = {
    "chinese": "zh",
    "english": "en",
    "japanese": "ja",
    "korean": "ko",
    "german": "de",
    "french": "fr",
    "spanish": "es",
    "russian": "ru",
    "arabic": "ar",
    "portuguese": "pt",
    "中文": "zh",
    "英文": "en",
    "日文": "ja",
    "韩文": "ko",
    "德文": "de",
    "法文": "fr",
    "西班牙文": "es",
    "俄文": "ru",
}


def normalize_lang_code(lang: str) -> str:
    """标准化语言代码"""
    lang = lang.lower().strip()
    if lang in LANG_MAP:
        return lang
    return LANG_ALIASES.get(lang, lang)


def detect_language(text: str) -> str:
    """简单的语言检测（基于字符范围）"""
    # 统计各类字符数量
    chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')
    ascii_chars = sum(1 for c in text if c.isascii() and c.isalpha())
    japanese_chars = sum(1 for c in text if '\u3040' <= c <= '\u30ff')
    korean_chars = sum(1 for c in text if '\uac00' <= c <= '\ud7af')

    total = len(text.strip())
    if total == 0:
        return "unknown"

    # 计算比例
    ratios = {
        "zh": chinese_chars / total,
        "en": ascii_chars / total,
        "ja": japanese_chars / total,
        "ko": korean_chars / total,
    }

    # 返回比例最高的语言
    max_lang = max(ratios, key=ratios.get)
    if ratios[max_lang] > 0.3:
        return max_lang

    # 默认返回中文（业务场景以中文为主）
    return "zh"


class TranslationService:
    """多语言翻译服务"""

    def __init__(self):
        self._llm_router = None

    @property
    def llm_router(self):
        if self._llm_router is None:
            from app.core.llm_router import llm_router
            self._llm_router = llm_router
        return self._llm_router

    async def translate(
        self,
        text: str,
        target_lang: str = "en",
        source_lang: str | None = None,
        context: str | None = None,
        style: str = "professional",
    ) -> TranslationResult:
        """
        翻译文本

        Args:
            text: 待翻译文本
            target_lang: 目标语言代码
            source_lang: 源语言代码（None则自动检测）
            context: 上下文信息（用于提高翻译准确性）
            style: 翻译风格（professional/casual/technical）
        """
        # 标准化语言代码
        target_lang = normalize_lang_code(target_lang)
        if source_lang:
            source_lang = normalize_lang_code(source_lang)
        else:
            source_lang = detect_language(text)

        # 如果源语言和目标语言相同，直接返回
        if source_lang == target_lang:
            return TranslationResult(
                source_lang=source_lang,
                target_lang=target_lang,
                source_text=text,
                translated_text=text,
                bilingual_text=text,
                confidence=1.0,
            )

        # 构建翻译提示词
        target_lang_name = LANG_MAP.get(target_lang, target_lang)
        source_lang_name = LANG_MAP.get(source_lang, source_lang)

        style_instructions = {
            "professional": "使用专业、正式的商务语言",
            "casual": "使用通俗易懂的日常语言",
            "technical": "使用精确的技术术语，保持专业性",
        }

        style_instruction = style_instructions.get(style, style_instructions["professional"])

        system_prompt = f"""你是一名专业的多语言翻译专家，精通{source_lang_name}和{target_lang_name}。

翻译要求：
1. 准确传达原文含义，不遗漏信息
2. {style_instruction}
3. 保持原文的格式和结构
4. 专业术语使用行业通用翻译
5. 数字、单位、型号等保持原样
{"6. 上下文信息：" + context if context else ""}

输出格式：
- 只输出翻译结果，不要添加解释
- 保持原文的段落和换行格式"""

        user_prompt = f"""请将以下{source_lang_name}文本翻译成{target_lang_name}：

{text}"""

        try:
            # 调用 LLM 进行翻译
            response = await self.llm_router.chat(
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                module="document",  # 使用 DeepSeek 进行翻译
                temperature=0.3,
            )

            translated_text = response.strip()

            # 生成双语对照格式
            bilingual_text = self._create_bilingual_text(
                text, translated_text, source_lang, target_lang
            )

            # 分段处理
            segments = self._create_segments(text, translated_text)

            return TranslationResult(
                source_lang=source_lang,
                target_lang=target_lang,
                source_text=text,
                translated_text=translated_text,
                bilingual_text=bilingual_text,
                confidence=0.85,  # LLM 翻译置信度
                segments=segments,
            )

        except Exception as e:
            logger.error(f"Translation failed: {e}")
            raise

    def _create_bilingual_text(
        self,
        source: str,
        translated: str,
        source_lang: str,
        target_lang: str,
    ) -> str:
        """创建双语对照文本"""
        source_lines = source.split('\n')
        translated_lines = translated.split('\n')

        bilingual_lines = []
        max_lines = max(len(source_lines), len(translated_lines))

        for i in range(max_lines):
            source_line = source_lines[i] if i < len(source_lines) else ""
            translated_line = translated_lines[i] if i < len(translated_lines) else ""

            if source_line.strip() or translated_line.strip():
                bilingual_lines.append(f"{source_line}")
                bilingual_lines.append(f"【{translated_line}】")
                bilingual_lines.append("")  # 空行分隔

        return '\n'.join(bilingual_lines)

    def _create_segments(
        self, source: str, translated: str
    ) -> list[dict[str, Any]]:
        """创建分段对照"""
        source_lines = source.split('\n')
        translated_lines = translated.split('\n')

        segments = []
        max_lines = max(len(source_lines), len(translated_lines))

        for i in range(max_lines):
            source_line = source_lines[i] if i < len(source_lines) else ""
            translated_line = translated_lines[i] if i < len(translated_lines) else ""

            if source_line.strip() or translated_line.strip():
                segments.append({
                    "index": i,
                    "source": source_line,
                    "translated": translated_line,
                })

        return segments

    async def translate_document(
        self,
        content: str,
        target_lang: str = "en",
        source_lang: str | None = None,
        document_type: str = "general",
    ) -> TranslationResult:
        """
        翻译整个文档

        Args:
            content: 文档内容
            target_lang: 目标语言
            source_lang: 源语言
            document_type: 文档类型（general/technical/legal/marketing）
        """
        # 根据文档类型选择翻译风格
        style_map = {
            "general": "professional",
            "technical": "technical",
            "legal": "professional",
            "marketing": "casual",
        }

        context_map = {
            "technical": "这是一份技术文档，请注意专业术语的准确翻译",
            "legal": "这是一份法律文件，请确保翻译的严谨性和准确性",
            "marketing": "这是一份营销材料，请注意语言的吸引力和可读性",
        }

        return await self.translate(
            text=content,
            target_lang=target_lang,
            source_lang=source_lang,
            context=context_map.get(document_type),
            style=style_map.get(document_type, "professional"),
        )

    async def batch_translate(
        self,
        texts: list[str],
        target_lang: str = "en",
        source_lang: str | None = None,
    ) -> list[TranslationResult]:
        """批量翻译"""
        results = []
        for text in texts:
            result = await self.translate(
                text=text,
                target_lang=target_lang,
                source_lang=source_lang,
            )
            results.append(result)
        return results


# 全局单例
translation_service = TranslationService()
