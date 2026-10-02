"""DXF 参数提取器（A03，一期净新建）。

基于 ezdxf 从 DXF 文件中提取：
1. 标题栏（title block）：结构化 key-value（图名/图号/比例/设计/日期/单位…）；
2. 尺寸标注（dimensions）：尺寸值、公差、直径、角度等带测量量的标注；
3. 图层归类（by layer）：按图层名分组文本，便于识别"参数表"等图层；
4. 结构化参数（params）：从标注 + 文本中按规则抽取的数值参数，带置信度与依据。

提取流程参见 docs/03_需求结构化引擎_深挖.md §5。
历史 dxf_analysis.py 为翻译比对脚本，与本模块无关，不复用。
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


def _read_dxf_bytes(ezdxf_module, content: bytes):
    """鲁棒地用 ezdxf 读取字节内容。

    ASCII/Binary DXF 的编码（GBK/UTF-8 混杂 CJK）通过纯字节流或 UTF-8 忽略解码
    容易丢字符，最可靠的是落临时文件再用 ezdxf.readfile（它内置编码探测）；
    失败再用 recover 兜底。
    """
    import os
    import tempfile

    fd, path = tempfile.mkstemp(suffix=".dxf")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(content)
        try:
            return ezdxf_module.readfile(path)
        except Exception:
            pass
        try:
            return ezdxf_module.recover.readfile(path)
        except Exception:
            return None
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

# 标题栏常见字段的中文标签与对应输出键。
# 命中任一别名即归入该字段。
TITLE_FIELD_MAP: dict[str, list[str]] = {
    "drawing_name": ["图名", "图形名称", "名称", "title"],
    "drawing_no": ["图号", "图样编号", "编号", "drawing no", "dwg no", "图样代号"],
    "scale": ["比例", "scale"],
    "designer": ["设计", "设计者", "绘制", "制图", "designed by", "drawn by"],
    "checker": ["审核", "校对", "checked by"],
    "date": ["日期", "date"],
    "company": ["单位", "公司", "公司名称", "单位名称"],
    "material": ["材料", "材质", "material"],
    "project": ["工程", "项目", "project"],
}

# 尺寸标注的测量量类型 → 中文/单位推断。
_DIM_TYPES = ("DIMENSION", "ARC_DIMENSION", "LARGE_RADIAL_DIMENSION",
              "ALIGNEDDIMENSION", "ANGULAR_DIMENSION", "ORDINATE",
              "RADIUS3D", "DIAMETERDIMENSION", "RADIUSDIMENSION")


@dataclass
class DxfParam:
    """从 DXF 抽取的结构化参数。"""
    key: str
    label: str
    value: str
    normalized: Optional[float]
    unit: Optional[str]
    confidence: float
    evidence: str
    source_layer: Optional[str] = None


@dataclass
class DxfExtractionResult:
    """DXF 提取的完整结果。"""
    title_block: dict[str, str] = field(default_factory=dict)
    title_block_raw: list[str] = field(default_factory=list)
    dimensions: list[dict[str, Any]] = field(default_factory=list)
    annotations: list[str] = field(default_factory=list)
    by_layer: dict[str, list[str]] = field(default_factory=dict)
    params: list[DxfParam] = field(default_factory=list)
    all_text: str = ""
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "titleBlock": [f"{k}: {v}" for k, v in self.title_block.items()]
            if self.title_block else self.title_block_raw,
            "titleBlockStructured": self.title_block,
            "dimensions": self.dimensions,
            "annotations": self.annotations,
            "byLayer": self.by_layer,
            "params": [p.__dict__ for p in self.params],
            "text": self.all_text,
            "warnings": self.warnings,
        }


def _entity_text(entity) -> str:
    """安全提取 TEXT/MTEXT 的纯文本。"""
    try:
        etype = entity.dxftype()
        if etype == "MTEXT":
            # plain_text() 去除格式码；部分版本 text 属性更可靠
            return entity.plain_text() or getattr(entity, "text", "") or ""
        if etype == "TEXT":
            return entity.dxf.text or ""
    except Exception:
        return ""
    return ""


def _resolve_dim_text(dim) -> str:
    """提取尺寸标注的显示文本（优先 MTEXT/TEXT 内容，回退到测量值）。"""
    try:
        # 1) 显式文本覆盖（用户自定义的标注文字）
        text_attr = getattr(dim.dxf, "text", None)
        if text_attr and text_attr.strip() not in ("", "<>"):
            return text_attr.strip()
        # 2) 关联的 TEXT/MTEXT
        for sub in getattr(dim, "sub_entities", []) or []:
            t = _entity_text(sub)
            if t:
                return t
        # 3) 测量值（measurement）
        measurement = getattr(dim, "get_measurement", lambda: None)()
        if measurement is not None:
            return f"{round(float(measurement), 3)}"
    except Exception:
        pass
    return ""


# 数值 + 常见单位识别：如 120吨 / 25.4 MPa / 100 mm / φ50
_NUM_UNIT = re.compile(
    r"(?P<num>\d+(?:\.\d+)?)\s*"
    r"(?P<unit>吨|t|kg|kN|N|MPa|bar|Pa|MPa|"
    r"mm|厘米|cm|米|m|英寸|inch|\"|"
    r"°C|度|kW|W|kV|V|A|Hz|rpm|转|L|升|mm/s|°)?",
    re.IGNORECASE,
)
# 中文"参数：值"或"参数 值"模式：公称力 120 吨 / 工作压力：25MPa
_LABEL_VAL = re.compile(
    r"(?P<label>[\u4e00-\u9fa5A-Za-z]{2,10})\s*[:：]?\s*"
    r"(?P<num>\d+(?:\.\d+)?)\s*(?P<unit>[a-zA-Z°%/\u4e00-\u9fa5]{0,4})"
)
# 直径标注 φ50 / DN100
_DIAMETER = re.compile(r"(?:φ|Φ|DN|Dn|Φ)\s*(?P<num>\d+(?:\.\d+)?)", re.IGNORECASE)

# 常见参数标签归一化（命中别名 → 标准 key/label/unit）
# 注意：别名按"最长命中"匹配（见 _match_param_label），因此可安全并存
# "工作压力"（working_pressure）与裸"压力"——较长别名优先。
_PARAM_ALIASES: list[tuple[list[str], str, str, str]] = [
    (["额定推力", "公称推力", "公称力", "额定力", "锁紧力", "推力"], "nominal_force", "公称力", "kN"),
    (["工作压力", "系统压力", "额定压力", "油压", "气压", "压力"], "working_pressure", "工作压力", "MPa"),
    (["流量", "排量"], "flow_rate", "流量", "L/min"),
    (["直径", "外径", "内径", "通径", "缸径"], "diameter", "直径", "mm"),
    (["行程", "位移"], "stroke", "行程", "mm"),
    (["功率", "电机功率", "额定功率"], "power", "功率", "kW"),
    (["电压", "额定电压"], "voltage", "电压", "V"),
    (["转速", "额定转速"], "rotational_speed", "转速", "rpm"),
    (["温度", "工作温度", "介质温度"], "temperature", "温度", "°C"),
    (["重量", "质量", "总重"], "weight", "重量", "kg"),
]


def _match_param_label(label_text: str) -> Optional[tuple[str, str, str]]:
    """把中文标签映射到标准参数定义。返回 (key, label, unit) 或 None。

    采用"最长别名命中"策略：当多个别名同时为标签子串时，取最长者，
    避免"工作压力"被裸"压力"误判为公称力（nominal_force）。
    """
    best: Optional[tuple[int, str, str, str]] = None  # (alias_len, key, label, unit)
    for aliases, key, label, unit in _PARAM_ALIASES:
        for a in aliases:
            if a and a in label_text and (best is None or len(a) > best[0]):
                best = (len(a), key, label, unit)
    if best is None:
        return None
    return best[1], best[2], best[3]


def extract_dxf(content: bytes, file_name: str = "upload.dxf") -> Optional[DxfExtractionResult]:
    """主提取入口。content 为 DXF 的原始字节。解析失败返回 None。"""
    try:
        import ezdxf
    except ImportError:
        logger.error("ezdxf is not installed; cannot extract DXF")
        return None

    doc = _read_dxf_bytes(ezdxf, content)
    if doc is None:
        logger.error("Failed to read DXF file: %s", file_name)
        return None

    result = DxfExtractionResult()

    # ---------- 1) 文本实体 + 图层归类 ----------
    texts: list[str] = []
    by_layer: dict[str, list[str]] = {}
    layer_texts_flat: list[str] = []

    def _collect(layout) -> None:
        for entity in layout:
            etype = entity.dxftype()
            txt = _entity_text(entity)
            if txt and txt.strip():
                txt = txt.strip()
                texts.append(txt)
                if txt not in result.annotations and etype == "MTEXT":
                    result.annotations.append(txt)
                layer = None
                try:
                    layer = entity.dxf.layer or "0"
                except Exception:
                    layer = "0"
                by_layer.setdefault(layer, [])
                if txt not in by_layer[layer]:
                    by_layer[layer].append(txt)
                layer_texts_flat.append(f"[{layer}] {txt}")

    msp = doc.modelspace()
    _collect(msp)

    # ---------- 2) 标题栏（非 Model 布局） ----------
    title_raw: list[str] = []
    try:
        for layout in doc.layouts:
            if layout.name == "Model":
                continue
            for entity in layout:
                txt = _entity_text(entity)
                if txt and txt.strip():
                    title_raw.append(txt.strip())
                    # 也纳入文本池，便于后续参数抽取
                    if txt.strip() not in texts:
                        texts.append(txt.strip())
    except Exception:
        logger.debug("Failed to iterate layouts for title block", exc_info=True)

    result.title_block_raw = title_raw
    result.title_block = _parse_title_block(title_raw, texts)

    # ---------- 3) 尺寸标注（测量值） ----------
    dims: list[dict[str, Any]] = []
    try:
        for entity in msp:
            if entity.dxftype() in _DIM_TYPES or "DIMENSION" in entity.dxftype():
                txt = _resolve_dim_text(entity)
                measurement = None
                try:
                    measurement = entity.get_measurement()
                    if measurement is not None:
                        measurement = round(float(measurement), 3)
                except Exception:
                    pass
                layer = "0"
                try:
                    layer = entity.dxf.layer or "0"
                except Exception:
                    pass
                if txt or measurement is not None:
                    dims.append({
                        "type": entity.dxftype(),
                        "text": txt,
                        "measurement": measurement,
                        "layer": layer,
                    })
    except Exception:
        logger.debug("Failed to extract dimensions", exc_info=True)
    result.dimensions = dims

    # ---------- 4) 结构化参数抽取 ----------
    # 来源优先级：尺寸标注 > 图层文本（高置信） > 标题栏/普通文本（中置信）
    full_text = "\n".join(texts) + "\n" + "\n".join(layer_texts_flat)
    result.all_text = "\n".join(texts)

    params = _extract_params_from_dims(dims)
    params += _extract_params_from_text(full_text, source_conf=0.85)
    # 去重：同一 key 保留首次（dims 优先级已在前面）
    seen_keys: set[str] = set()
    deduped: list[DxfParam] = []
    for p in params:
        if p.key in seen_keys:
            continue
        seen_keys.add(p.key)
        deduped.append(p)
    result.params = deduped

    result.by_layer = by_layer

    if not texts and not dims:
        result.warnings.append("DXF 中未发现任何文本或尺寸标注，可能为纯几何图或已损坏。")
    return result


def _parse_title_block(title_raw: list[str], all_texts: list[str]) -> dict[str, str]:
    """把标题栏文本解析成 key-value。优先用"标签：值"模式，回退到关键字过滤。"""
    out: dict[str, str] = {}
    pool = title_raw if title_raw else all_texts
    blob = "\n".join(pool)

    # 模式 A：label：value
    kv_pattern = re.compile(
        r"(?P<label>[\u4e00-\u9fa5A-Za-z]{2,6})\s*[:：]\s*"
        r"(?P<value>[^\n:：]{1,60})"
    )
    for m in kv_pattern.finditer(blob):
        label = m.group("label").strip()
        value = m.group("value").strip()
        for key, aliases in TITLE_FIELD_MAP.items():
            if any(a in label for a in aliases) and key not in out:
                out[key] = value
                break

    # 模式 B：关键字就近匹配（仅补齐缺失项）
    if len(out) < len(TITLE_FIELD_MAP):
        for key, aliases in TITLE_FIELD_MAP.items():
            if key in out:
                continue
            for alias in aliases:
                if alias in blob:
                    # 取该关键字后最近的非空白片段
                    idx = blob.find(alias) + len(alias)
                    tail = blob[idx:idx + 40].strip(" :\t：，,。.\n")
                    m2 = re.match(r"([^\n]{1,40})", tail)
                    if m2 and m2.group(1):
                        out[key] = m2.group(1).strip()
                        break
    return out


def _extract_params_from_dims(dims: list[dict[str, Any]]) -> list[DxfParam]:
    """从尺寸标注中抽取参数。直径标注 → diameter，其余作为通用尺寸。"""
    params: list[DxfParam] = []
    for d in dims:
        text = d.get("text") or ""
        measurement = d.get("measurement")
        layer = d.get("layer")
        # 直径标注
        if measurement is not None and ("DIA" in d.get("type", "").upper() or
                                        re.search(r"[φΦD]", text)):
            params.append(DxfParam(
                key="diameter",
                label="直径",
                value=str(measurement),
                normalized=float(measurement),
                unit="mm",
                confidence=0.92,
                evidence=f"尺寸标注: {text or measurement} (layer={layer})",
                source_layer=layer,
            ))
    return params


def _extract_params_from_text(text: str, source_conf: float = 0.8) -> list[DxfParam]:
    """从文本中按"参数名 + 数值 + 单位"模式抽取参数。"""
    params: list[DxfParam] = []
    found_keys: set[str] = set()

    for m in _LABEL_VAL.finditer(text):
        label_text = m.group("label")
        num = m.group("num")
        unit = m.group("unit") or ""
        match = _match_param_label(label_text)
        if not match:
            continue
        key, std_label, std_unit = match
        if key in found_keys:
            continue
        try:
            normalized = float(num)
        except ValueError:
            continue
        # 单位归一化：若文本带了单位就用文本单位，否则用标准单位
        unit_use = unit if unit else std_unit
        params.append(DxfParam(
            key=key,
            label=std_label,
            value=f"{num}{unit_use}",
            normalized=normalized,
            unit=unit_use,
            confidence=source_conf,
            evidence=f"{label_text} {num}{unit}",
        ))
        found_keys.add(key)

    # 补充直径模式 φ50 / DN100（若尚未抽到 diameter）
    if "diameter" not in found_keys:
        for m in _DIAMETER.finditer(text):
            num = m.group("num")
            params.append(DxfParam(
                key="diameter",
                label="直径",
                value=f"{num}mm",
                normalized=float(num),
                unit="mm",
                confidence=0.8,
                evidence=m.group(0),
            ))
            break
    return params
