# syntax=docker/dockerfile:1.4
FROM node:24-alpine3.24@sha256:e67514e5d0f6c46656005e1b693b2ec9d52e80b641307de684d4a015ba7a4eaf AS prepared

WORKDIR /app
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Keep the runner's npm CLI, with the same patched tooling as the API toolbox.
COPY npm-toolchain/package.json npm-toolchain/package-lock.json /tmp/locked-npm/
RUN npm ci --prefix /tmp/locked-npm --ignore-scripts --no-audit --no-fund && \
    rm -rf /usr/local/lib/node_modules/npm && \
    cp -a /tmp/locked-npm/node_modules/npm /usr/local/lib/node_modules/npm && rm -rf /tmp/locked-npm && \
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

# Use maintained native browsers/libraries instead of Debian's unfixed packages.
# Preserve both full Chromium and the headless shell, plus video recording.
# Security: pin libexpat 2.10.0-r0 — fixes HIGH CVE-2026-117610 / CVE-2026-118370
# flagged by Trivy on 2.9.0-r0 (FixedVersion 2.10.0-r0 in Alpine v3.24).
# chromium pins refreshed to 156.0.8078.79-r0: 155.0.8059.84-r0 left the v3.24
# repo, so any rebuild of this image (new E2E_VERSION) fails to resolve otherwise.
RUN npm ci --legacy-peer-deps --ignore-scripts && \
    apk add --no-cache libcrypto3=3.5.9-r0 libssl3=3.5.9-r0 chromium=156.0.8078.79-r0 \
      chromium-headless-shell=156.0.8078.79-r0 ffmpeg=8.1.3-r0 libexpat=2.10.0-r0 zlib=1.3.2-r1 && \
    node -e 'const fs=require("node:fs"),path=require("node:path"); const {registry}=require("playwright-core/lib/coreBundle").registry; for(const [name,binary] of [["chromium","/usr/bin/chromium"],["chromium-headless-shell","/usr/bin/chromium-headless-shell"],["ffmpeg","/usr/bin/ffmpeg"]]){const executable=registry.findExecutable(name).executablePath(); fs.mkdirSync(path.dirname(executable),{recursive:true}); fs.symlinkSync(binary,executable); console.log(name,executable,"->",binary);}' && \
    node --input-type=module -e 'import {chromium} from "playwright"; import assert from "node:assert/strict"; import {stat} from "node:fs/promises"; for(const channel of [undefined,"chromium"]){const browser=await chromium.launch({channel}); console.log("Qualified Chromium:",channel??"headless shell",browser.version()); const context=await browser.newContext({recordVideo:{dir:"/tmp/browser-probe"}}); const page=await context.newPage(); await page.setContent("<title>BR78 browser probe</title><main style=\"background:#246;color:white;padding:40px\">BR78 browser probe</main>"); assert.equal(await page.title(),"BR78 browser probe"); await page.waitForFunction(()=>performance.getEntriesByName("first-contentful-paint").length>0,undefined,{timeout:2000}); const png=await page.screenshot({path:"/tmp/browser-probe.png"}); assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a"); const video=page.video(); await context.close(); assert.ok((await stat(await video.path())).size>0); await browser.close();}' && \
    rm -rf /root/.npm /tmp/*

# Flatten the prepared filesystem so removed packages/download caches are absent
# from transported layers. Keep apk metadata for the existing container scanner.
FROM scratch AS base
COPY --from=prepared / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app

CMD ["npm", "run", "test"]
