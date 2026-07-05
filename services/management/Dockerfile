# === ЭТАП 1: Сборка фронтенда ===
FROM node:20-slim AS frontend-builder
WORKDIR /build

COPY ./services/management/frontend/package*.json ./
# Принудительно ставим Linux-пакеты для сборщика (Vite/Rolldown)
RUN npm install --platform=linux --arch=x64
COPY ./services/management/frontend/ ./
RUN npm run build

# === ЭТАП 2: Запуск бэкенда ===
FROM node:20-slim
WORKDIR /app

COPY ./services/management/package*.json ./
# Принудительно ставим Linux-пакеты для бэкенда
RUN npm install --platform=linux --arch=x64
COPY ./services/management/backend/ ./

# Копируем собранный фронтенд в изолированную папку public
COPY --from=frontend-builder /build/dist ./public

EXPOSE 80

CMD ["node", "server.js"]
