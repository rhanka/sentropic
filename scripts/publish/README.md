# Public library publication

The 18 reusable libraries in [packages.mjs](packages.mjs) use the existing
publishable-manifest guard. `pack-<slug>` builds and verifies the real npm archive;
`publish-<slug>` is restricted to the main-branch GitHub Actions OIDC workflow.
Application packages `auth-idp` and `llm-gateway-host` remain private.

## First publication: owner web login

Use a clean, reviewed commit after the draft PR has passed CI and the owner has
approved release. The agent never executes this procedure. Run it in your own
interactive terminal, with your npm account authorized for `@sentropic`:

```sh
rtk make prepare-npm-bootstrap PKGS="ubo-contracts mcp-broker connector-host mcp-connector-airtable mcp-connector-dropbox mcp-connector-github mcp-connector-gmail mcp-connector-google mcp-connector-googlecalendar mcp-connector-googledocs mcp-connector-googledrive mcp-connector-googlesheets mcp-connector-hubspot mcp-connector-linear mcp-connector-notion mcp-connector-slack mcp-connector-stripe skills" ENV=test-publish-mcp-packages
rtk make test-publishable-consumer ENV=test-publish-mcp-packages
rtk make npm-bootstrap-web PKGS="ubo-contracts mcp-broker connector-host mcp-connector-airtable mcp-connector-dropbox mcp-connector-github mcp-connector-gmail mcp-connector-google mcp-connector-googlecalendar mcp-connector-googledocs mcp-connector-googledrive mcp-connector-googlesheets mcp-connector-hubspot mcp-connector-linear mcp-connector-notion mcp-connector-slack mcp-connector-stripe skills" ENV=test-publish-mcp-packages
```

`PKGS` accepts a nonempty subset of declared package slugs. Preparation builds in
a disposable Node 24 container and writes strict guard receipts plus tarballs
under `tmp/npm-bootstrap/`. Consumer qualification installs each tarball into its
own fresh directory/cache and imports all public Node exports, without mounting
the repository. Publication never rebuilds or repacks those archives.

The bootstrap verifies receipt identity, commit SHA and SHA-256 bytes before
login, then checks dependency versions against the selected archives or npm.
It rejects packages that already exist. Dependencies precede their consumers;
`@sentropic/mcp-platform@^0.3.0` must already be published. The 18 new libraries
have no dependencies on one another, so the command above is a valid order.

The throwaway `node:24-bookworm` container runs `npm login --auth-type=web` and
prints npm's login URL. Open it in your browser and approve using your security
key. There is no manually created access token or host `.npmrc` mount. npm's web
session/config/cache exist only in container tmpfs; logout revokes the session
where possible, and `--rm` destroys the container on success, failure or interrupt.
No credentials are written to the tarball directory or the repository.

Local web login cannot issue GitHub Actions SLSA provenance. The first publication
explicitly disables provenance; every later CI release requires it. If npm's
organization policy rejects the web session, the command fails and the owner
must resolve that policy through npm's browser UI; there is no token fallback.

Each publication must have its matching `<slug>@<version>` release tag at the
reviewed source commit, following the repository's release discipline.

If a batch stops after publishing some packages, remove those slugs from `PKGS`
before retrying. Do not attempt to republish an existing immutable version.

## Attach npm Trusted Publishers

After first publication, open each package on npmjs.com, then **Settings →
Trusted Publisher → GitHub Actions** and configure:

- Organization/user: `rhanka`
- Repository: `sentropic`
- Workflow filename: `ci.yml`
- Environment: leave empty (these jobs do not use a GitHub environment)

Every new package's `bootstrap_publish_target` choice directs you to the owner
web procedure before any legacy token step can execute. Existing legacy token
bootstrap targets are preserved for the older publication train.

## Later versions and checks

Bump the package version and refresh workspace lock entries through
`make lock-public-libraries ENV=test-publish-mcp-packages`. CI validates package
tests, compilation, guarded archive contents and clean consumer imports. Only
`packages/<slug>/**` changes select its OIDC publisher on main; root lock or shared
tooling changes validate packages without selecting publication.

```sh
rtk make test-publication-scripts ENV=test-publish-mcp-packages
rtk make test-publishable-manifests ENV=test-publish-mcp-packages
rtk make test-public-libraries ENV=test-publish-mcp-packages
rtk make test-publishable-consumers ENV=test-publish-mcp-packages
```
