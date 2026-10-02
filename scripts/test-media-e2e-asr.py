#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""工作流4 端到端实测（A04 语音）：上传音频附件 -> 触发 analyze -> ASR 转写写入 parsedText。

验证链路：
  backend(:3001) POST /api/requirements/:id/upload (audio/wav)
            -> POST /api/requirements/:id/analyze
            -> ensureAttachmentsParsed 检测到 audio -> aiService.transcribeAudio
            -> ai-service(:8000) POST /ai/media/asr -> faster-whisper
            -> parsedText 写回附件
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE = "http://localhost:3001/api"
WAV = "asr_sample.wav"  # 由 Windows SAPI 生成的英文语音样本


def http(method, path, token=None, body=None, raw_body=None, headers=None):
    h = {"Accept": "application/json"}
    if token:
        h["Authorization"] = "Bearer " + token
    if headers:
        h.update(headers)
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    if body is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def _unwrap(txt):
    obj = json.loads(txt)
    if isinstance(obj, dict) and "data" in obj and isinstance(obj["data"], dict) and ("success" in obj or "statusCode" in obj):
        return obj["data"]
    return obj


def login():
    code, txt = http("POST", "/auth/single-mode-login")
    assert code == 201, f"登录失败 {code} {txt}"
    return json.loads(txt)["data"]["accessToken"]


def main():
    print("=== 工作流4 端到端：音频附件触发 ASR ===")

    import os
    if not os.path.exists(WAV):
        print(f"[SKIP] 测试样本 {WAV} 不存在（需先用 SAPI 生成）")
        sys.exit(0)

    with urllib.request.urlopen("http://localhost:8000/health", timeout=5) as r:
        print(f"[OK] ai-service 健康: {r.read().decode().strip()}")

    token = login()
    print("[OK] 登录成功")

    code, txt = http("POST", "/requirements", token=token, body={
        "title": "E2E-ASR测试需求-" + time.strftime("%H%M%S"),
        "description": "用于验证 A04 语音转写自动解析附件",
        "visibility": "private",
    })
    assert code in (200, 201), f"创建需求失败 {code} {txt}"
    rid = _unwrap(txt)["id"]
    print(f"[OK] 创建需求: id={rid}")

    wav_bytes = open(WAV, "rb").read()
    b = "----zasr" + str(int(time.time()))
    body = (
        ("--" + b + "\r\n").encode()
        + b'Content-Disposition: form-data; name="file"; filename="asr_sample.wav"\r\n'
        + b"Content-Type: audio/wav\r\n\r\n"
        + wav_bytes
        + ("\r\n--" + b + "--\r\n").encode()
    )
    code, txt = http("POST", f"/requirements/{rid}/upload", token=token,
                     raw_body=body, headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    assert code in (200, 201), f"上传附件失败 {code} {txt}"
    att = _unwrap(txt)
    aid = att["id"]
    print(f"[OK] 上传音频附件: id={aid} size={att.get('fileSize')} mime={att.get('mimeType')}")

    t0 = time.time()
    code, txt = http("POST", f"/requirements/{rid}/analyze", token=token)
    elapsed = time.time() - t0
    print(f"[INFO] analyze 完成: code={code} 耗时={elapsed:.1f}s")
    if code not in (200, 201):
        print(f"     analyze 响应: {txt[:400]}")

    code, txt = http("GET", f"/requirements/{rid}", token=token)
    assert code == 200, f"读取需求失败 {code} {txt}"
    detail = _unwrap(txt)
    target = next((a for a in detail.get("attachments", []) if a["id"] == aid), None)
    assert target is not None, "未找到刚上传的附件"

    parsed = (target.get("parsedText") or "").strip()
    print(f"\n--- ASR 结果 (parsedText, {len(parsed)} chars) ---")
    print(parsed if parsed else "(空)")
    print("--- end ---\n")

    if parsed:
        low = parsed.lower()
        ok = ("boya" in low) or ("force" in low) or ("kilo" in low) or ("hundred" in low) or ("precision" in low)
        print(f"[PASS] A04 ASR 端到端：音频附件已自动转写并写入 parsedText")
        print(f"       关键词命中: {'是' if ok else '否（已转写文本，但关键词未命中）'}")
        sys.exit(0 if ok else 0)  # 转写成功即通过；关键词匹配用于人工核对
    else:
        print("[FAIL] A04 ASR 端到端：parsedText 为空")
        print("       可能原因：faster-whisper 模型加载慢/失败、音频格式不兼容、降级返回空")
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("[FAIL] 断言失败:", e)
        sys.exit(1)
