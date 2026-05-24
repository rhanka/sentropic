FROM node:24-alpine

WORKDIR /app

COPY package.json index.js ./
RUN npm install --omit=dev

CMD ["node", "index.js"]
