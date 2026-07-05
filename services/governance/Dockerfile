FROM node:20-slim

WORKDIR /app

COPY ./services/governance/package*.json ./
RUN npm install  --omit=dev

COPY ./services/governance/ .

EXPOSE 8002

CMD ["node", "app.js"]