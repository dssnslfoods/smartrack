FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY . .
RUN node server/seed.js
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
