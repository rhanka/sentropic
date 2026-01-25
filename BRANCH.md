# Feature: Admin workspace cleanup

## Objective
Remove legacy admin workspace scope logic and align admin_app access with workspace memberships.

## Plan / Todo
- [x] Allow admin_app workspace management + remove legacy share_with_admin checks
- [x] Remove admin scope store and API comment
- [x] Remove admin workspaces endpoint and spec refs
- [x] make lint typecheck 
- [x] make test-ui test-api
- [x] make build-ui-image build-api && make clean test e2e


## Commits & Progress
- [x] **Commit 1**: API workspace access cleanup
- [x] **Commit 2**: UI admin scope cleanup
- [x] **Commit 3**: Remove admin workspaces endpoint + docs

## Status
- **Progress**: 3/3 tasks completed
- **Current**: All planned commits done
- **Next**: Review for any remaining legacy references
