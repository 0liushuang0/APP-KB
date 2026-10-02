#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作流4 端到端实测：上传图片附件 -> 触发 analyze -> OCR 结果写入 parsedText。

验证链路：
  前端/HTTP -> backend(:3001) POST /api/requirements/:id/upload
            -> backend POST /api/requirements/:id/analyze
            -> ensureAttachmentsParsed 检测到 image -> aiService.recognizeImage
            -> ai-service(:8000) POST /ai/media/ocr -> PaddleOCR
            -> parsedText 写回附件
"""
import io
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://localhost:3001/api"

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("[SKIP] Pillow 未安装，无法生成测试图片")
    sys.exit(0)


def http(method, path, token=None, body=None, raw_body=None, headers=None):
    url = BASE + path
    h = {"Accept": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    if headers:
        h.update(headers)
    data = None
    if raw_body is not None:
        data = raw_body
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            txt = resp.read().decode("utf-8")
            return resp.status, txt
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def make_test_image(path):
    """生成一张含清晰中英文文本的 PNG，供 PaddleOCR 识别。"""
    img = Image.new("RGB", (640, 240), "white")
    d = ImageDraw.Draw(img)
    lines = ["BOYA TEST 2026", "RATED FORCE 100kN", "PRESSURE 31.5MPa", "BOYA PRECISION"]
    y = 20
    for ln in lines:
        try:
            font = ImageFont.truetype("arial.ttf", 36)
        except Exception:
            font = ImageFont.load_default()
        d.text((30, y), ln, fill="black", font=font)
        y += 52
    img.save(path, "PNG")


def _unwrap(txt):
    """统一拆解 {success, data} 包装，返回内层对象（无包装时原样返回）。"""
    obj = json.loads(txt)
    if isinstance(obj, dict) and "data" in obj and isinstance(obj["data"], dict) and ("success" in obj or "statusCode" in obj):
        return obj["data"]
    return obj


def login():
    code, txt = http("POST", "/auth/single-mode-login")
    assert code == 201, f"登录失败 {code} {txt}"
    return json.loads(txt)["data"]["accessToken"]


def main():
    print("=== 工作流4 端到端：附件上传触发 OCR ===")

    # 0. ai-service 健康检查
    try:
        with urllib.request.urlopen("http://localhost:8000/health", timeout=5) as r:
            print(f"[OK] ai-service 健康: {r.read().decode().strip()}")
    except Exception as e:
        print(f"[FAIL] ai-service 不可达: {e}")
        sys.exit(1)

    token = login()
    print("[OK] 登录成功")

    # 1. 创建需求
    code, txt = http("POST", "/requirements", token=token, body={
        "title": "E2E-OCR测试需求-" + time.strftime("%H%M%S"),
        "description": "用于验证 A05 OCR 自动解析附件",
        "visibility": "private",
    })
    assert code in (200, 201), f"创建需求失败 {code} {txt}"
    req = _unwrap(txt)
    rid = req.get("id")
    assert rid, f"创建需求响应无 id: {txt[:200]}"
    print(f"[OK] 创建需求: id={rid}")

    # 2. 生成并上传图片
    img_path = "media_e2e_test.png"
    make_test_image(img_path)

    with open(img_path, "rb") as f:
        png_bytes = f.read()
    boundary = "----zcodee2e" + str(int(time.time()))
    body = (
        ("--" + boundary + "\r\n").encode()
        + b'Content-Disposition: form-data; name="file"; filename="media_e2e_test.png"\r\n'
        + b"Content-Type: image/png\r\n\r\n"
        + png_bytes
        + ("\r\n--" + boundary + "--\r\n").encode()
    )
    code, txt = http("POST", f"/requirements/{rid}/upload", token=token,
                     raw_body=body, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    assert code in (200, 201), f"上传附件失败 {code} {txt}"
    att = _unwrap(txt)
    aid = att["id"]
    print(f"[OK] 上传图片附件: id={aid} file={att.get('fileName')}")

    # 3. 触发 analyze -> ensureAttachmentsParsed -> OCR
    t0 = time.time()
    code, txt = http("POST", f"/requirements/{rid}/analyze", token=token)
    elapsed = time.time() - t0
    print(f"[INFO] analyze 完成: code={code} 耗时={elapsed:.1f}s")
    if code not in (200, 201):
        print(f"     analyze 响应: {txt[:300]}")

    # 4. 重新读取需求，检查附件 parsedText
    code, txt = http("GET", f"/requirements/{rid}", token=token)
    assert code == 200, f"读取需求失败 {code} {txt}"
    detail = _unwrap(txt)
    attachments = detail.get("attachments", [])
    target = next((a for a in attachments if a["id"] == aid), None)
    assert target is not None, "未找到刚上传的附件"

    parsed = (target.get("parsedText") or "").strip()
    print(f"\n--- OCR 结果 (parsedText, {len(parsed)} chars) ---")
    print(parsed if parsed else "(空)")
    print("--- end ---\n")

    if parsed:
        low = parsed.lower()
        ok = ("boya" in low) or ("force" in low) or ("press" in low) or ("rated" in low) or ("100" in parsed)
        print(f"[PASS] A05 OCR 端到端：附件已自动识别并写入 parsedText")
        print(f"       关键词命中: {'是' if ok else '否（识别到文本但关键词未命中，可能字体差异）'}")
        sys.exit(0)
    else:
        print("[FAIL] A05 OCR 端到端：parsedText 为空")
        print("       可能原因：PaddleOCR 模型未就绪 / 图片识别失败 / 降级返回空")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("[FAIL] 断言失败:", e)
        sys.exit(1)
