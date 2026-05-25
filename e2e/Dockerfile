# syntax=docker/dockerfile:1.4
FROM mcr.microsoft.com/playwright:v1.58.1-noble AS base

WORKDIR /app

COPY package.json package-lock.json ./
COPY playwright.config.ts ./
COPY global.setup.ts ./

# Install the locked test runner dependencies. The base image already includes
# Playwright browsers and OS dependencies.
RUN npm ci --legacy-peer-deps --ignore-scripts

# Copier les fichiers de test
# COPY helpers/ ./helpers/
# COPY tests/ ./tests/

# Commande par défaut
CMD ["npm", "run", "test"]
