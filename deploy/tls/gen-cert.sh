#!/usr/bin/env bash
# 内网 TLS 证书生成（Git Bash 自带 openssl，无需安装任何东西）
#
# 用法：
#   ./deploy/tls/gen-cert.sh [局域网IP] [附加域名...]
#   例：./deploy/tls/gen-cert.sh 192.168.1.50 aikb.local
#
# 产出（deploy/tls/ 下）：
#   aikb-server.key  私钥
#   aikb-server.crt  证书（含 localhost/127.0.0.1/主机名/IP 的 SAN）
#
# 说明：自签证书浏览器会提示"不受信任"，属预期——内网部署把 crt
# 导入客户端"受信任的根/个人"后即绿锁；有企业 CA 的请改用企业签发。
set -euo pipefail

cd "$(dirname "$0")"

LAN_IP="${1:-}"
EXTRA_DNS=("${@:2}")

HOSTNAME_STR="$(hostname)"
SAN="DNS:localhost,DNS:${HOSTNAME_STR},IP:127.0.0.1"
if [ -n "$LAN_IP" ]; then
  SAN="${SAN},IP:${LAN_IP}"
fi
for d in "${EXTRA_DNS[@]:-}"; do
  [ -n "$d" ] && SAN="${SAN},DNS:${d}"
done

# Git Bash 会把 -subj "/CN=..." 误当路径改写（变成 D:/Program Files/Git/CN=...），
# MSYS_NO_PATHCONV 关掉这层转换（仅影响本脚本进程）
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

openssl req -x509 -newkey rsa:2048 -nodes -keyout aikb-server.key -out aikb-server.crt \
  -days 3650 \
  -subj "/CN=${HOSTNAME_STR}/O=AIKB-Intranet" \
  -addext "subjectAltName=${SAN}" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "extendedKeyUsage=serverAuth"

echo "✓ 证书已生成（10 年有效期）"
echo "  SAN：${SAN}"
echo "  文件：$(pwd)/aikb-server.crt / aikb-server.key"
echo ""
echo "客户端信任导入（Windows，管理员 PowerShell，每台员工机一次）："
echo "  certutil -addstore -f Root \"$(pwd)/aikb-server.crt\""
