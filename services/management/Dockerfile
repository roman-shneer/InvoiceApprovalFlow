
FROM node:20-slim AS frontend-builder
WORKDIR /build

COPY ./services/management/frontend/package*.json ./

RUN npm install --platform=linux --arch=x64
COPY ./services/management/frontend/ ./
RUN npm run build


FROM node:20-slim
WORKDIR /app

COPY ./services/management/package*.json ./

RUN npm install --platform=linux --arch=x64
COPY ./services/management/backend/ ./


COPY --from=frontend-builder /build/dist ./public

EXPOSE 80

CMD ["node", "server.js"]
