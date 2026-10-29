FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json index.js ./
RUN npm ci --omit=dev

CMD ["node", "index.js"]
