# Derived hotfix image: replaces ONLY @hono/node-server (GHSA-jpvv-r467-5p4w) in an exact,
# digest-pinned production image. No application code is rebuilt or changed.
ARG BASE
FROM ${BASE}
ARG ORIG_USER=root
ARG EXPECTED_OLD=1.19.17
ARG EXPECTED_NEW=1.19.18
ARG BASE_REF
ARG SOURCE_REVISION
LABEL org.opencontainers.image.source="https://github.com/rhanka/sentropic" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      org.opencontainers.image.base.name="${BASE_REF}" \
      org.opencontainers.image.description="Production image with @hono/node-server patched to ${EXPECTED_NEW} (GHSA-jpvv-r467-5p4w); nothing else changed" \
      ca.sent-tech.patched-dependency="@hono/node-server@${EXPECTED_NEW}"
USER root
COPY node-server.tgz /tmp/node-server.tgz
RUN set -eu; \
    found="$(find / -xdev -type d -path '*/node_modules/@hono/node-server' -prune -print)"; \
    n="$(printf '%s\n' "$found" | grep -c . || true)"; \
    [ "$n" = 1 ] || { echo "expected exactly one @hono/node-server, found $n: $found" >&2; exit 1; }; \
    old="$(node -p "require('$found/package.json').version")"; \
    [ "$old" = "${EXPECTED_OLD}" ] || { echo "unexpected installed version $old" >&2; exit 1; }; \
    owner="$(stat -c '%u:%g' "$found")"; \
    mkdir /tmp/hn; tar -xzf /tmp/node-server.tgz -C /tmp/hn; \
    new="$(node -p "require('/tmp/hn/package/package.json').version")"; \
    [ "$new" = "${EXPECTED_NEW}" ] || { echo "unexpected tarball version $new" >&2; exit 1; }; \
    rm -rf "$found"; mv /tmp/hn/package "$found"; chown -R "$owner" "$found"; \
    rm -rf /tmp/hn /tmp/node-server.tgz
USER ${ORIG_USER}
