# syntax=docker/dockerfile:1.4
FROM node:24-trixie-slim@sha256:89c5244bc22a9bc3287d89ebc7e49b9cb5bb84cd40e6175ac3421d5a9f68b95a AS prepared

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Keep the runner's npm CLI, with the same patched tooling as the API toolbox.
RUN npm install -g npm@11.16.0 && \
    mkdir -p /tmp/npm-patches && \
    for dependency in brace-expansion@5.0.12 undici@6.29.1 http-cache-semantics@4.3.0 \
      glob@11.1.0 tar@7.5.22 minimatch@10.2.4 ip-address@10.3.1 pacote@21.5.1 picomatch@4.0.4; do \
      package="${dependency%@*}"; version="${dependency##*@}"; \
      destination="/usr/local/lib/node_modules/npm/node_modules/$package"; \
      if [ "$package" = picomatch ]; then \
        destination=/usr/local/lib/node_modules/npm/node_modules/tinyglobby/node_modules/picomatch; \
      fi; \
      npm pack "$dependency" --pack-destination /tmp/npm-patches && \
      rm -rf "$destination" && mkdir -p "$destination" && \
      tar -xzf "/tmp/npm-patches/$package-$version.tgz" --strip-components=1 \
        -C "$destination" || exit 1; \
    done && rm -rf /tmp/npm-patches /root/.npm

COPY package.json package-lock.json ./
COPY playwright.config.ts ./
COPY global.setup.ts ./

# Retain full Chromium for IdP/extension checks and its default headless shell.
# All selected browser tests run headless; no X server is needed in this image.
RUN npm ci --legacy-peer-deps --ignore-scripts && \
    npx playwright install --with-deps chromium && \
    apt-get update && apt-get upgrade -y && \
    apt-get purge -y xvfb xserver-common && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /root/.npm /tmp/*

# Flatten the prepared filesystem so removed packages/download caches are absent
# from transported layers. Keep dpkg metadata for the existing container scanner.
FROM scratch AS base
COPY --from=prepared / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

CMD ["npm", "run", "test"]
