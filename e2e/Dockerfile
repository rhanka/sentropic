# syntax=docker/dockerfile:1.4
FROM node:24-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY playwright.config.ts ./
COPY global.setup.ts ./

# Installer les dépendances
RUN npm install --legacy-peer-deps && \
    npx playwright install --with-deps chromium

# Copier les fichiers de test
# COPY helpers/ ./helpers/
# COPY tests/ ./tests/

# Commande par défaut
CMD ["npm", "run", "test"]
