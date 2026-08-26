FROM node:22-slim
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .

# ข้อมูลอยู่บน Supabase (PostgreSQL) — คอนเทนเนอร์ไม่เก็บสถานะอะไรไว้เอง
# จึง deploy ซ้ำ/ขยายจำนวน instance ได้โดยข้อมูลไม่หาย
# ต้องส่ง DATABASE_URL เข้ามาตอนรัน:  docker run -e DATABASE_URL=...
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
