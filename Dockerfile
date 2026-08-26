FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .

# ฐานข้อมูลต้องอยู่บน "ดิสก์ถาวร" ที่ mount เข้ามาที่ /data — ไม่ใช่ในอิมเมจ
# (ถ้าเก็บไว้ในอิมเมจ ข้อมูลจะหายทุกครั้งที่ deploy ใหม่)
ENV RAG_DB=/data/rag.db
ENV PORT=8080
VOLUME ["/data"]

EXPOSE 8080
CMD ["node", "server/index.js"]
