# syntax=docker/dockerfile:1.19.0@sha256:b6afd42430b15f2d2a4c5a02b919e98a525b785b1aaff16747d2f623364e39b6
# Keep freshly packaged downloads outside the compiler's cache inputs. API-only
# builds preserve their existing optional-desktop behavior on a fresh checkout.
FROM node:24-alpine3.24@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS static-assets
WORKDIR /assets
COPY ui/static/ ./
RUN if [ -d cowork-desktop ]; then \
    test -s cowork-desktop/cowork.exe && test -s cowork-desktop/cowork-desktop-metadata.json; fi

FROM node:24-alpine3.24@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS base
WORKDIR /workspace
RUN apk add --no-cache zip
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
COPY packages/cluster-mesh/package.json ./packages/cluster-mesh/package.json
COPY packages/llm-mesh/package.json ./packages/llm-mesh/package.json
RUN if [ -f package-lock.json ]; then npm ci --workspaces --include-workspace-root; \
    else npm install --workspaces --include-workspace-root; fi
# Security: audit production deps for HIGH/CRITICAL. Exception-aware gate
# (GHSA allowlist + expiry) — see .security/audit-gate.mjs + vulnerability-register.yaml.
COPY .security/audit-gate.mjs .security/audit-allowlist.json ./.security/
RUN node .security/audit-gate.mjs --omit=dev --workspace sentropic-ui
# API/browser sources do not participate in either UI profile.
COPY --exclude=**/cowork-desktop --exclude=**/cowork-desktop/** ui ./ui
COPY packages ./packages

FROM base AS development
WORKDIR /workspace/ui
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# Execute the existing suite without exporting/loading a development image.
# CI disables this stage's cache so a warm build still executes every test.
FROM base AS ui-tests
WORKDIR /workspace/ui
ARG VITE_API_BASE_URL=http://localhost:8787/api/v1
ARG VITE_EXTENSION_PROFILE=uat
ARG VITE_EXTENSION_API_BASE_URL=http://localhost:8787/api/v1
ARG VITE_EXTENSION_APP_BASE_URL=http://localhost:5173
ARG VITE_EXTENSION_WS_BASE_URL=
COPY api/package-lock.json /workspace/api/package-lock.json
COPY Makefile docker-compose*.yml /workspace/
COPY .github/workflows/ci.yml /workspace/.github/workflows/ci.yml
COPY deploy/k8s/base/30-api.yaml deploy/k8s/base/40-ui.yaml /workspace/deploy/k8s/base/
RUN npx svelte-kit sync && npm test && mkdir /test-passed && touch /test-passed/ui

FROM scratch AS ui-test-output
COPY --from=ui-tests /test-passed/ /

FROM base AS build
WORKDIR /workspace/ui
ARG VITE_API_BASE_URL=/api/v1
ARG VITE_EXTENSION_PROFILE
ARG VITE_EXTENSION_API_BASE_URL
ARG VITE_EXTENSION_APP_BASE_URL
ARG VITE_EXTENSION_WS_BASE_URL=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_EXTENSION_PROFILE=$VITE_EXTENSION_PROFILE
ENV VITE_EXTENSION_API_BASE_URL=$VITE_EXTENSION_API_BASE_URL
ENV VITE_EXTENSION_APP_BASE_URL=$VITE_EXTENSION_APP_BASE_URL
ENV VITE_EXTENSION_WS_BASE_URL=$VITE_EXTENSION_WS_BASE_URL
RUN echo "VITE_API_BASE_URL=$VITE_API_BASE_URL"
RUN echo "VITE_EXTENSION_PROFILE=$VITE_EXTENSION_PROFILE"
RUN echo "VITE_EXTENSION_API_BASE_URL=$VITE_EXTENSION_API_BASE_URL"
RUN echo "VITE_EXTENSION_APP_BASE_URL=$VITE_EXTENSION_APP_BASE_URL"
RUN test ! -e static/cowork-desktop/cowork.exe && npm run build && \
    test -f chrome-ext/dist/manifest.json && \
    test -f chrome-ext/dist/content.js && \
    test -f chrome-ext/dist/chrome-ext/popup.html && \
    test -f chrome-ext/dist/chrome-ext/sidepanel.html && \
    test -f static/chrome-extension/sentropic-chrome-extension.zip && \
    test -f static/vscode-extension/sentropic-vscode-extension.vsix && \
    test -f vscode-ext/dist/extension.cjs
CMD ["npm", "run", "build"]

# A distinct static profile is exported without rebuilding a development image.
FROM scratch AS static-output
COPY --from=build /workspace/ui/build /
COPY --from=static-assets /assets/ /

FROM nginx:1.31.5-alpine3.24@sha256:72ba65eb42c10344912a84ff42408db7d34f2feb642204570ab8fc5ffd29f1d3 AS production
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*
COPY --from=build /workspace/ui/build /usr/share/nginx/html
COPY --from=static-assets /assets/ /usr/share/nginx/html/
COPY ui/nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
