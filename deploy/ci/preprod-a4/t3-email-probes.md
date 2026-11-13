# T3 email probe recipients

`emailProbe.email` is a dedicated operator mailbox. Before authorizing a window,
qualify delivery to `local+t3-<24 lowercase hex characters>@domain` through both
the application and IdP email-code endpoints. The mailbox must support these
subaddresses. Use a local part of at most 36 bytes and a base address of at most
226 bytes, leaving room for the 28-byte tag within email limits. Never use a
customer address. Explicit `config.probes` S-9 bodies follow the same contract.

Every real S-9a/S-9b POST gets a fresh cryptographically random 96-bit tag,
generated immediately before sending. Both hosts and every recovery attempt use
different recipients, including when the preceding request committed but its
response was lost. The configured base body stays unchanged. No code waits for,
resets or alters the application's shared three-codes-per-address/600s limit.

Acceptance still requires both functional JSON replies before `ACCEPTED` and
uses the original shared monotonic deadline. Previews send no POST. This is an
issuance probe; code consumption and full login remain separate qualifications.
