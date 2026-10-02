FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app

RUN apk add --no-cache curl postgresql-client

COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# 数据目录
RUN mkdir -p /app/data/uploads/documents /app/data/backups

EXPOSE 3000

# nest build 的产物在 dist/src/（tsconfig outDir=dist + 入口 src/main.ts），
# 之前写 dist/main.js 容器一起就 ExitError，与 package.json 的 start:prod 保持一致
CMD ["node", "dist/src/main.js"]
