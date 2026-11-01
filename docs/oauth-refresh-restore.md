# OAuth refresh authority after database restore

Keep all IdP token ingress closed throughout restore, migration and invalidation. A database snapshot can contain a spent generation or a family whose later revocation is absent from that snapshot.

1. Stop every serving IdP/API replica or deny token ingress at the ingress controller.
2. Restore the database and apply pending public/control migrations with the normal Make targets.
3. Run `SELECT public.oauth_refresh_invalidate_restore();` in the restored database. This serializes against client/user/family writers, marks restored families revoked with `db_restore_invalidation`, invalidates offline authorization codes and removes access metadata.
4. Verify there are no unrevoked refresh rows and no OAuth access metadata, then reopen ingress. Keep ingress closed if migration or invalidation fails.

`make db-restore` and `make k8s-db-restore-preprod` invoke the invalidation function and fail if it is unavailable. An older backup requires applying the control migration before completing this gate. Never copy refresh rows, offline consent epochs, resource approvals or token metadata between tiers.

Browser logout preserves separately consented offline MCP families. Explicit connector revocation, offline consent withdrawal, account/membership denial, revoke-all and authorized security events invalidate their affected authority. D-R1, D-R2 and D-R3 remain **pending owner ratification**.
