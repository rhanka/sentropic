# SPEC EVOL - Release CI, Package Publishing, UI Pretest Agent

Status: Draft for roadmap orchestration (2026-02-22)

## 1) Objective
Deliver a release-ready CI pipeline aligned with 1-2 week goals:

- Milestone W1 (deadline: 2026-03-01)
  - Publish Svelte UI package to npm automatically via CI.
  - Integrate a Playwright UI debug/pretest agent in build flow.
- Milestone W2 (deadline: 2026-03-08)
  - Publish Chrome plugin and VSCode plugin artifacts automatically via CI.

## 2) Scope

In scope:
- CI release workflows with versioning and provenance.
- Package publishing for UI and plugins.
- Pretest stage using Playwright agent for UI regression and debug artifacts.
- Artifact collection (logs/screenshots/videos) for fast debug.

Out of scope:
- Full product marketing release workflows.
- Non-CI manual release operations as default path.

## 3) Existing baseline
Relevant references:
- `.cursor/rules/testing.mdc`
- `.cursor/rules/workflow.mdc`
- `spec/SPEC_CHROME_PLUGIN.md`
- `spec/VELOCITY.md`
- `TODO.md` (`publish UI/chrome/vscode`, `agent test UI playwright` items)

Current state summary:
- Build/test flows exist with Make targets.
- Release publishing is not fully automated across UI + plugins.
- No dedicated UI debug-pretest agent integrated in CI.

## 4) Target design

### 4.1 Release workflow
- Trigger strategy:
  - release tags (recommended) or controlled branch promotions.
- Versioning strategy:
  - semver + changelog automation.
- Provenance:
  - npm provenance/signature where available.

### 4.2 Package outputs
- UI package:
  - publish to npm in W1.
- Chrome plugin package:
  - produce signed/zip artifact and optional store upload in W2.
- VSCode extension package:
  - produce `.vsix` and publish in W2.

### 4.3 Playwright UI debug/pretest agent
- Add pretest stage before publish:
  - targeted smoke scenarios,
  - configurable exploratory debug script,
  - screenshot/video capture on failure,
  - structured report artifact.
- Make output consumable by developers and future in-app debug assistants.

## 5) Branch plan

- `feat/release-ui-npm-and-pretest`
  - UI npm publish automation + Playwright pretest agent v1.
- `feat/release-chrome-vscode-ci-publish`
  - Chrome + VSCode publish automation.

## 6) Acceptance criteria

W1:
- UI package can be published from CI without manual npm steps.
- Pretest agent runs before publish and blocks release on critical failures.
- Debug artifacts are attached to CI runs.

W2:
- Chrome plugin and VSCode plugin publish pipelines are automated.
- Publishing is tied to explicit release policy (tag/approval gate).
- End-to-end release run is reproducible from clean CI context.

## 7) Open questions

- `REL-Q1`: What are the final npm package names/scopes for UI and plugin artifacts?
- `REL-Q2`: Should release be tag-driven only, or allow branch-based prereleases?
- `REL-Q3`: Which signing/provenance requirements are mandatory at launch?
- `REL-Q4`: What is the minimum pretest gate (smoke only vs broader suite) for W1?
- `REL-Q5`: How long should CI debug artifacts be retained for team workflows?

## 8) Risks

- Credential/secrets misconfiguration for multi-registry publishing.
- Long pretest duration impacting release lead time.
- Divergent versioning across UI/chrome/vscode artifacts.
