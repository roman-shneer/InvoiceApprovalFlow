FROM node:20-slim AS frontend-builder
WORKDIR /build
COPY ./frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --platform=linux --arch=x64
COPY ./frontend/ ./
RUN npm run build

FROM node:20-slim
WORKDIR /app
COPY ./package*.json ./
COPY ./tsconfig.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install --platform=linux --arch=x64
COPY ./backend ./backend
RUN npm run build

COPY --from=frontend-builder /build/dist ./public
COPY --from=frontend-builder /build/dist ./dist/backend/public

EXPOSE 80
CMD ["node", "dist/backend/server.js"]