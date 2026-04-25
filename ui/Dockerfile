# syntax=docker/dockerfile:1.4
FROM node:24-alpine AS base
WORKDIR /workspace
RUN apk add --no-cache zip
COPY package.json package-lock.json* ./
COPY api/package.json ./api/package.json
COPY ui/package.json ./ui/package.json
RUN if [ -f package-lock.json ]; then npm ci --workspaces --include-workspace-root; \
    else npm install --workspaces --include-workspace-root; fi
# Security: Audit production dependencies for HIGH/CRITICAL vulnerabilities
RUN npm audit --audit-level=high --omit=dev --workspaces --include-workspace-root
COPY . .

FROM base AS development
WORKDIR /workspace/ui
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

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
RUN npm run build
CMD ["npm", "run", "build"]

FROM nginx:1.29-alpine AS production
RUN apk update && apk upgrade && rm -rf /var/cache/apk/*
COPY --from=build /workspace/ui/build /usr/share/nginx/html
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
CMD ["nginx", "-g", "daemon off;"]
