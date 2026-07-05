FROM node:18-alpine
WORKDIR /app
COPY ./services/payment/package.json package.json
RUN npm install --production
COPY . .
EXPOSE 8010
CMD ["npm", "start"]
