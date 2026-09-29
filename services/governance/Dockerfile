FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

RUN npm install  --omit=dev

COPY . .
RUN npm run build
EXPOSE 8002

#CMD ["node", "app.js"]
CMD ["node", "dist/app.js"]