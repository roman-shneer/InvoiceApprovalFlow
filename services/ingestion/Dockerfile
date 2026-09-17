FROM node:20-alpine

WORKDIR /app

COPY ./services/ingestion/package*.json ./
RUN npm install

COPY ./services/ingestion/ .
RUN npm run build
RUN npm prune --production

EXPOSE 8001

CMD ["sh", "-c", "node dist/app.js"]
