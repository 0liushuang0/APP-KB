#!/usr/bin/env node
/**
 * 零依赖 HTTPS 反向代理（内网商用部署的 TLS 终结点）。
 *
 * 职责：把一个 HTTPS 入口拆到两个本地 HTTP 服务——
 *   /api/*、/uploads/*  →  后端  BACKEND（默认 127.0.0.1:3101）
 *   其余（含前端页面、Vite HMR WebSocket）→  FRONTEND（默认 127.0.0.1:5274）
 *
 * 不引入 http-proxy/nginx 的原因：部署机是普通 Windows，没有 Docker，
 * Node 内置 https/net 模块即可完成 TLS 终结 + WebSocket 透传，
 * 零安装、可审计。
 *
 * 用法：
 *   node scripts/https-proxy.mjs
 * 环境变量：
 *   TLS_PORT=8443                          监听端口
 *   TLS_CERT=deploy/tls/aikb-server.crt    证书
 *   TLS_KEY=deploy/tls/aikb-server.key     私钥
 *   BACKEND=http://127.0.0.1:3101          后端源站
 *   FRONTEND=http://127.0.0.1:5274         前端源站
 *
 * 启用后请同步在 .env 设置 COOKIE_SECURE=true（Secure Cookie 经 HTTPS 传输）。
 */
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const TLS_PORT = parseInt(process.env.TLS_PORT || '8443', 10);
const TLS_CERT = path.resolve(root, process.env.TLS_CERT || 'deploy/tls/aikb-server.crt');
const TLS_KEY = path.resolve(root, process.env.TLS_KEY || 'deploy/tls/aikb-server.key');
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:3101';
const FRONTEND = process.env.FRONTEND || 'http://127.0.0.1:5274';

for (const f of [TLS_CERT, TLS_KEY]) {
  if (!fs.existsSync(f)) {
    console.error(`✗ 找不到 ${f}，先运行 deploy/tls/gen-cert.sh 生成证书`);
    process.exit(1);
  }
}

const backendUrl = new URL(BACKEND);
const frontendUrl = new URL(FRONTEND);

/** 按路径挑源站：API 与上传走后端，其余（页面/静态/HMR）走前端 */
function pickTarget(pathname) {
  return pathname.startsWith('/api') || pathname.startsWith('/uploads')
    ? { host: backendUrl.hostname, port: parseInt(backendUrl.port, 10) }
    : { host: frontendUrl.hostname, port: parseInt(frontendUrl.port, 10) };
}

const server = https.createServer(
  { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) },
  (req, res) => {
    const target = pickTarget(req.url || '/');
    const proxyReq = http.request(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: req.headers.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (err) => {
      console.error(`上游不可达（${target.host}:${target.port}）：${err.message}`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('上游服务不可用，请确认后端/前端已启动');
    });
    req.pipe(proxyReq);
  },
);

// WebSocket 透传（Vite HMR）：TLS 层解密后按字节转发给源站
server.on('upgrade', (req, clientSocket, head) => {
  const target = pickTarget(req.url || '/');
  const upstream = net.connect(target.port, target.host, () => {
    const hostHeader = `Host: ${target.host}:${target.port}`;
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(req.headers)) {
      // Host 由本行重写，其余原样转发（含 Upgrade/Connection/Sec-WebSocket-Key）
      if (k.toLowerCase() === 'host') continue;
      raw += `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`;
    }
    raw += `${hostHeader}\r\n\r\n`;
    upstream.write(raw);
    if (head && head.length) upstream.write(head);
    clientSocket.pipe(upstream);
    upstream.pipe(clientSocket);
  });
  upstream.on('error', () => {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
  });
  clientSocket.on('error', () => upstream.destroy());
});

server.listen(TLS_PORT, () => {
  console.log(`✓ HTTPS 入口已启动：https://localhost:${TLS_PORT}`);
  console.log(`   API/上传 → ${BACKEND}；页面/HMR → ${FRONTEND}`);
  console.log('   记得在 .env 设置 COOKIE_SECURE=true 并重启后端。');
});
