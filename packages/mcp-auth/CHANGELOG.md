# Changelog

## 0.2.1

- Replace the local oauth-verify dependency reference with `^0.1.0` so npm consumers can resolve the published dependency outside the monorepo.
- Guard published dependency declarations against local file, workspace, link, and parent-directory references.
