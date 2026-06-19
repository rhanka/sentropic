# Fix: auth.sent-tech.ca header — use DS AppChrome (not the bare AppHeader)

## Objective
The IdP header rendered as an unstyled strip ("foireux") because `apps/auth-idp/web/+layout.svelte` used the minimal `AppHeader` + a raw `LanguageToggle` in a plain `<div>`. Replace it with the DS **`AppChrome`** — the assembled, parameterized top bar of design-system.sent-tech.ca (composes AppHeader + the utility controls incl. the built-in language selector). Owner-requested ("faut utiliser l'appshell").

## Scope / Guardrails
- Make-only, Docker-first. English only.
- Single-file UI change in the IdP host; no auth-ui/contract change.

## Branch Scope Boundaries
- **Allowed**: `apps/auth-idp/web/src/routes/+layout.svelte`, `BRANCH.md`
- **Forbidden**: everything else.

## Plan / Todo
- [x] Replace `<AppHeader>` + `<LanguageToggle>` with `<AppChrome brandName="SENT" productName="Sentropic ID" locale onLocaleChange>` (built-in language selector) in `+layout.svelte`.
- [x] Verify: `make build-idp-web` PASS (AppChrome compiles); Playwright snapshot confirms the polished bar renders (brand + icon language selector) replacing the bare strip.
- [ ] Final: PR → CI green → merge → include in the manual prod deploy.

## Deferred
- Same AppChrome adoption in the product `ui/` /auth host layout (separate; ui/ has its own header outside /auth).
- Visual screenshot pending (shared Playwright browser was saturated; snapshot confirmed structure).
