# Cluster Mesh Lot 23 historical workspace fixture

- Source commit: `c94401b9a9397068c3b344bbffbea465f0ff497b`.
- `/neutral` source blob: `0bc4f0c2182a7ea1a0049254731868210afdaa15`.
- `/tenants` source blob: `f52667a442ee7f5fc9b53f0a7ec3810668c89ea0`.
- The route files are byte-identical executable historical source, not reconstructed mocks.
- Test-only bridges re-export the current canonical DB/schema and tenant-membership authorities.
- Production must never import or mount this fixture.
