FROM node:20-slim
WORKDIR /app
COPY ./services/payment/package.json package.json
RUN npm install --production
COPY . .
EXPOSE 8010
CMD ["npm", "start"]
