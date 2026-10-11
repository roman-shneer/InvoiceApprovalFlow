FROM node:20-alpine
WORKDIR /app
COPY ./package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install
COPY ./ ./
RUN npm run build
RUN npm prune --production
EXPOSE 8001
CMD ["node", "dist/app.js"]