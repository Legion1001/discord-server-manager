FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY .env.example ./
COPY README.md ./

RUN mkdir -p /app/data/economy /app/exports /app/logs

CMD ["node", "src/bot.js"]
