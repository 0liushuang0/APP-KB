"""可读性判定: 中英双语文档不能被误杀, 二进制残渣/乱码仍要拦住"""
from app.core.parser import looks_like_text


def test_bilingual_spec_with_tables_is_readable():
    # 中文 ~14%、英文字母 ~59%: 两条单语门槛都差一点的典型双语规格书片段
    block = (
        "电镀锡线1450组合拉矫机组\nETL 1450 Combine type Tension leveller unit\n技术规格书\nTechnical Specification\n"
        "| 序号 No. | 参数 Parameter | 数值 Value |\n| --- | --- | --- |\n"
        "| 1 | 带钢厚度 Strip thickness | 0.15~0.6 mm |\n| 2 | 带钢宽度 Strip width | 700~1300 mm |\n"
        "Supplier: BOYA Precision Industrial Equipments Co., Ltd. and the Buyer shall confirm the delivery schedule.\n"
    )
    assert looks_like_text(block * 6)


def test_binary_residue_and_garbage_still_rejected():
    assert not looks_like_text("hN h$ B*CJ H*OJ PJ QJ aJ o(ph " * 10)
    assert not looks_like_text("\x00\x01\x02 ~~~ ### ??? !!! @@@ $$$ %%% ^^^ " * 10)
    assert not looks_like_text("5\n/\n1\n3\n.\n" * 20)


def test_short_or_symbol_only_text_rejected():
    assert not looks_like_text("abc")
    assert not looks_like_text("| --- | --- | --- |\n" * 30)
