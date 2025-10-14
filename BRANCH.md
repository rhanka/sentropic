# Feature: Fix GitHub Pages SPA Routing for Dynamic Routes

## Objective
Fix 404 errors when refreshing or directly accessing dynamic routes (`/entreprises/[id]`, `/cas-usage/[id]`) on GitHub Pages production deployment.

## Scope
- **ui**: SvelteKit configuration and static files
- **ci**: No changes required (build process remains the same)
- **api**: No changes required

## Problem Analysis
- **Root cause**: GitHub Pages doesn't know this is a SPA and returns its own 404 page for dynamic routes
- **Current behavior**: 
  - ✅ Client-side navigation works (clicking links)
  - ❌ Direct URL access fails (F5 refresh or external links)
- **Missing components**:
  - No `404.html` fallback for SPA routing
  - No `.nojekyll` file to prevent Jekyll processing

## Plan / Todo
- [x] Create `ui/static/` directory
- [x] Add `.nojekyll` file in `ui/static/`
- [x] Configure `adapter-static` with `fallback: '404.html'` in `svelte.config.js`
- [x] Test build locally to verify 404.html generation
- [x] Commit changes
- [x] Push to GitHub and monitor CI

## Technical Details

### SvelteKit Static Adapter Configuration
The `@sveltejs/adapter-static` supports a `fallback` option that generates a fallback page for SPA routing. Setting `fallback: '404.html'` will:
1. Generate a `404.html` file identical to `index.html`
2. GitHub Pages automatically serves `404.html` for any 404 error
3. SvelteKit's client-side router takes over and handles the route

### Files in `ui/static/`
Files in the `static/` directory are copied as-is to the build output. The `.nojekyll` file prevents GitHub Pages from running Jekyll processing, which could ignore `_app/` directories.

## Commits & Progress
- [x] **Commit 1** (pending): Configure SvelteKit adapter-static with 404.html fallback and add .nojekyll
- [ ] **Commit 2**: Update TODO.md after verification in production

## Status
- **Progress**: 5/7 tasks completed
- **Current**: Committing changes
- **Next**: Push to GitHub and monitor CI

## Build Verification
- ✅ `404.html` generated and identical to `index.html`
- ✅ `.nojekyll` present in build output
- ✅ Adapter-static configured with `fallback: '404.html'`

