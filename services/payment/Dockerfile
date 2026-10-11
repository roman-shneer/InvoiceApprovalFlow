FROM node:20-slim
WORKDIR /app
COPY ./package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm install
COPY ./ ./
RUN npm run build
RUN npm prune --production
EXPOSE 8010
CMD ["npm", "start"]