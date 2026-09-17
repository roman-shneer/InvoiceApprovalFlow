FROM node:20-slim AS frontend-builder
WORKDIR /build
COPY ./services/management/frontend/package*.json ./
RUN npm install --platform=linux --arch=x64
COPY ./services/management/frontend/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app

COPY ./services/management/package*.json ./
COPY ./services/management/tsconfig.json ./
RUN npm install --platform=linux --arch=x64

# ✅ Сохраняем папку целиком
COPY ./services/management/backend ./backend

RUN npm run build

COPY --from=frontend-builder /build/dist ./public
COPY --from=frontend-builder /build/dist ./dist/backend/public

EXPOSE 80
CMD ["node", "dist/backend/server.js"]