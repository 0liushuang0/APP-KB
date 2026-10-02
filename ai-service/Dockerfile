FROM python:3.11-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

FROM python:3.11-slim AS production

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /root/.local /root/.local

ENV PATH=/root/.local/bin:$PATH
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

COPY . .

EXPOSE 8000

# host 由环境变量控制：容器部署时 docker-compose 设 HOST=0.0.0.0（容器内
# 绑所有网卡，端口由 compose 网络隔离）；本地直接跑时 config.py 默认 127.0.0.1。
# 之前硬编码 0.0.0.0 会绕过 config.py 的回环绑定安全设置。
CMD uvicorn main:app --host ${HOST:-0.0.0.0} --port ${PORT:-8000}
