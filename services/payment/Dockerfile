FROM node:20-slim
WORKDIR /app
COPY ./services/payment/package*.json ./
RUN npm install
COPY ./services/payment/ .
RUN npm run build
RUN npm prune --production
EXPOSE 8010
CMD ["npm", "start"]
