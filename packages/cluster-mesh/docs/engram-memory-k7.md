# Engram memory K7 carriage and version rule

Cluster-mesh `0.24.0-dev.5` carries every producer K7 field unchanged inside
the kernel proof, including `receipt_digest` and unknown extensions. Only
`record_digest` is stored separately as `recordDigest`, because completion may
add it. Reads reconstruct the producer's canonical JSON bytes from that row
alone; they never reconstruct a receipt from the pending-control row.

Engram `0.22.0` chooses the initial aggregate version as
`record_digest !== undefined ? '2' : '1'` when no prior row exists. Subsequent
writes use the prior aggregate version plus one. The adapter's semantic proof
revision is 1 before completion and 2 when `record_digest` is present; it does
not replace the aggregate version supplied by Engram. Kernel transition
validation still requires creation before completion.

K7 rows written by cluster-mesh dev.3/dev.4 without `receipt_digest` are refused
by Engram hydration without migration. No automatic migration or receipt
reconstruction is provided. A differing `receipt_digest` and control
`capture_receipt_digest` is also refused with `JOURNAL_CORRUPT`.

The E10 installed lane runs these missing/divergent receipt probes for created
and completed K7 against installed Engram `0.22.0` and installed cluster-mesh
dev.5, with matching positive reopens and canonical byte checks. Those probes
use an in-memory fault-injection host; the same lane separately proves real
PostgreSQL capture, admission, reads and restart/replay in two processes.

The intentHash requirement remains an interim fail-closed deviation: Engram
`0.22.0` supplies no producer-owned carrier at `transaction.apply`. The current
computation remains pending Engram `0.21.3` and
[rhanka/engram#410](https://github.com/rhanka/engram/issues/410). Gate condition 2
and promotion remain blocked until producer-owned intent carriage is verified.
