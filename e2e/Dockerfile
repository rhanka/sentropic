# syntax=docker/dockerfile:1.4
FROM mcr.microsoft.com/playwright:v1.40.0-focal

WORKDIR /app

# Copier les fichiers de test
COPY package.json ./
COPY playwright.config.ts ./
COPY tests/ ./tests/

# Installer les dépendances
RUN npm install

# Installer les navigateurs Playwright
RUN npx playwright install --with-deps

# Commande par défaut
CMD ["npm", "test"]
