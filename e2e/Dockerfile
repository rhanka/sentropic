# syntax=docker/dockerfile:1.4
FROM node:24-slim AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY playwright.config.ts ./

# Installer les dépendances
RUN npm install --legacy-peer-deps && \
    npx playwright install --with-deps chromium

# Copier les fichiers de test
COPY tests/ ./tests/

# Commande par défaut
CMD ["npm", "run", "test"]
