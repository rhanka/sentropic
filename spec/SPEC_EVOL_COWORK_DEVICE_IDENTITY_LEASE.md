# SPEC EVOL — BR-41c: Cowork Device Identity, Durable Registry and Targeted Lease

> **Status:** DESIGN ONLY. No product code is written or planned to change in this branch.
> **Branch:** `feat/cowork-device-identity-lease` (BR-41c), PENDING architect ratification via
> negotiation `neg:cowork-cu-cadrage-20260718`. **Note:** the benchmark study's boundary register
> names this branch `feat/cowork-device-identity-routing` (§9 line 401); the actual worktree branch
> is `feat/cowork-device-identity-lease`. Content matches the study's BR-41c scope; the name
> deviation is flagged here for the architect to note at ratification, not treated as a defect.
> **Scope:** WP-COWORK-TRUST / WP-COWORK-RUNTIME, epic **NOW-1** from the benchmark study below.
> **Grounding:** `/home/antoinefa/src/sentropic/tmp/cowork-benchmark-study/spec/SPEC_STUDY_COWORK_COMPUTER_USE_BENCHMARK.md`
> (§3 capability inventory C1–C22, §5 threat model, §6 NOW-1, §7 decisions D1–D12, §9 BR-41c
> boundaries). All current-behavior claims below cite this worktree's code (`path:line`); every
> design choice is explicitly tagged **PROPOSAL** and separated from cited **FACT**.

## 1. Problem and current-state facts

Sentropic Cowork (`@sentropic/cowork-desktop@0.2.0`) enrolls a headless Windows binary against a
user's account and makes it visible to chat as a routing target. Today this identity is not a
security boundary — it is a display convenience. Five current-state facts ground the problem:

1. **Ephemeral device identity.** `device_<uuid>` is minted **server-side**, not by the client:
   `generateTabId()` (`api/src/services/tab-registry.ts:40-43`) is invoked from `register()`
   whenever no `tab_id` is supplied (`api/src/services/tab-registry.ts:49-56`). The desktop client
   never sends a `tab_id` at all — its registration request body carries only
   `{source, url, title}` (`packages/cowork-desktop/src/registry/registry-client.ts:68-72`).
   `RegistryClient.register()` is idempotent only **within one running process**: it returns the
   already-cached `this.tabId` if set (`registry-client.ts:63-64`), but nothing is written to disk,
   so a fresh process (every CLI launch) always requests — and receives — a brand-new
   server-minted id. The CLI calls `registry.register()` unconditionally on every launch
   (`packages/cowork-desktop/src/cli/run.ts:103-110`). Nothing on disk or in the DB says "this is
   the same workstation that enrolled yesterday." The only persisted identity is the *user's*
   session (`packages/cowork-desktop/src/storage/file-store.ts:78-95`), not the device's.

2. **Registry mutations do not verify ownership.** `POST /chrome-extension/tabs/register` reads
   `user.userId` from the authenticated context and stores it on the entry
   (`api/src/routes/api/chrome-extension.ts:63-69`), but `POST /chrome-extension/tabs/keepalive`
   (`api/src/routes/api/chrome-extension.ts:74-86`) and `DELETE /chrome-extension/tabs/:tabId`
   (`api/src/routes/api/chrome-extension.ts:88-92`) accept a bare `tab_id`/`tabId` and call
   `touchTab` / `unregister` (`api/src/services/tab-registry.ts:75-77,118-124`) without ever
   comparing the entry's `userId` to `c.get('user')`. Both routes sit behind `requireAuth`
   (`api/src/routes/api/index.ts:106-107`), so *some* user is authenticated, but any authenticated
   user who learns or guesses another device's `tab_id` can keepalive-refresh it or unregister it.
   This is capability inventory item **C10** in the benchmark study, confirmed at code level here.

3. **The registry itself is process-local.** `tab-registry.ts` stores entries in a bare
   `Map<string, TabEntry>` (`api/src/services/tab-registry.ts:38`) with no persistence layer — an
   API restart silently drops every registered device (**C9**, confirmed).

4. **Device-code pending state is process-local too.** `device-code-store.ts` keeps pending codes
   in `Map`s (`api/src/services/device-code-store.ts:40-41`) with an explicit comment that entries
   "do not survive server restarts" (`api/src/services/device-code-store.ts:10-11`). An API restart
   during the enrollment window silently fails a mid-flight pairing (**C8**, confirmed).

5. **Enrollment carries no device-generated key material.** `POST /auth/device/code` accepts only
   `{ deviceName }` (`api/src/routes/auth/device.ts:28-30,47-63`); `approveDeviceCode` binds a
   `user_code` to `{ userId, role, deviceName }` with no public key, fingerprint, or
   proof-of-possession (`api/src/services/device-code-store.ts:124-139`). Enrollment trust rests
   entirely on the human matching a 4-character code (**C7**, confirmed); this is the "enrollment
   phishing" threat in the study (§5 threat table).

6. **SSE is user-scoped, not device-scoped.** `GET /streams/sse` resolves a target workspace and
   authorizes chat/organization/folder/initiative/job streams against `user.userId`
   (`api/src/routes/api/streams.ts:242-372`). There is no `deviceId` query dimension, no per-device
   channel, and no concept of "this device may only see leases addressed to it" anywhere in this
   file. A same-user second device attached to the same SSE connection semantics would see the same
   event surface (**required-gap register, "Device→stream delivery for a headless device"**,
   PARTIALLY VERIFIED in the study).

7. **The CLI re-enrolls instead of refreshing.** `runCli()` only checks `store.readSession()` in
   memory-adjacent local storage; if absent it runs the full device-code handshake again
   (`packages/cowork-desktop/src/cli/run.ts:78-99`). The bridge's `SessionAuthClient` already
   implements refresh-on-skew (`packages/cowork-bridge/src/auth/session-auth.ts:187-198`), but the
   CLI never constructs or calls it — it drives `DeviceCodeClient` directly and only reads
   `store.readSession()?.sessionToken` for the access token
   (`packages/cowork-desktop/src/cli/run.ts:101`). This is **C14**, confirmed.

8. **No session-to-device binding exists.** `userSessions` (`api/src/db/schema.ts:185-201`) has a
   free-text `deviceName` column for display only — no `deviceId` foreign key, no key-binding, no
   DPoP-style proof requirement on the bearer token itself. Binding the *session token* to a device
   key is therefore not something this branch can build on; it is a distinct, later concern owned by
   the auth lane (see §6).

**Net effect:** "device identity" today is a session-scoped user grant plus a free-text label. There
is no artifact that says "this specific enrolled key belongs to this specific workstation, is still
valid, and is the only thing allowed to consume a lease addressed to it." NOW-1 in the benchmark
study names this the release gate before any tool-call can be safely device-targeted.

## 2. Device identity

### 2.1 Enrollment envelope — PROPOSAL

Today's device-code flow (`api/src/routes/auth/device.ts`) issues session tokens but never mints a
durable device record. This branch adds a device-generated asymmetric key pair as the identity
anchor, kept separate from the bearer session token (see boundary in §6).

**Client-side (Cowork desktop, `packages/cowork-desktop`):**

- On first run, if no persisted device identity exists, the binary generates a key pair
  (**PROPOSAL: Ed25519**, WebCrypto/`node:crypto` `generateKeyPair('ed25519', ...)` — small
  signatures, fast verify, broadly supported; see open question OQ-1 for ratification) and a
  client-generated `deviceId` (UUIDv4).
- The private key is persisted through the existing `StorageAdapter` seam
  (`packages/cowork-bridge/src/auth/storage-adapter.ts:14-22`), alongside — not merged with — the
  existing `auth.json` persistent auth state written by `file-store.ts:78-86`. **PROPOSAL:** a new
  `device-identity.json` file (same `0o600` mode as `file-store.ts:46`), read/written through a new
  adapter method (or a sibling interface) so `StorageAdapter` implementers (Chrome extension, future
  desktop hosts) that never need a device identity are not forced to implement it.
- `deviceId` and the key pair are generated **once** and reused across restarts. This directly
  replaces fact 1 above (registry client's fresh `device_<uuid>` per launch).

**Enrollment request extension** to `POST /auth/device/code`
(today: `{ deviceName }`, `api/src/routes/auth/device.ts:28-30`):

```
{ deviceName?, deviceId, devicePublicKey, capabilities: string[] }
```

- `deviceId`: client-generated UUID, stable across restarts.
- `devicePublicKey`: exported public key (PROPOSAL: base64url SPKI or JWK — open question OQ-1).
- `capabilities`: advertised local-tool surface, e.g. `['screen_capture', 'input_action']`
  (matches the two tools in `packages/cowork-desktop/src/tools/registry.ts:12-21`, **C3**). This is
  stored for the eligibility check BR-41d will use when selecting a target device; BR-41c does not
  interpret capability semantics beyond storing and returning them. **PROPOSAL:** because this
  field arrives on an unauthenticated enrollment request (fact 5), the server validates it against
  the known tool-name enum (`tools/registry.ts:12-21`) and rejects unrecognized values, and bounds
  the array (e.g. max 16 entries, each ≤64 chars) — it is attacker-controlled input and must not be
  stored or echoed verbatim.

**Server verification steps — PROPOSAL:**

1. `POST /auth/device/code` stages a **pending device-identity record** (not yet trusted) holding
   `{deviceId, devicePublicKey, capabilities, requestedDeviceName}`, keyed to the same short-lived
   entry as the existing `DeviceCodeEntry` (`api/src/services/device-code-store.ts:16-33`). The
   response additionally returns a `serverNonce`: a fresh random challenge bound to this pending
   entry, used for proof-of-possession (PoP). **PROPOSAL:** `serverNonce` is at least 128 bits of
   CSPRNG output (not the shorter human-facing `user_code`), and `POST /auth/device/code` is
   rate-limited both per source IP and per authenticated approver. 41b already deferred this exact
   follow-up ("rate-limit `/auth/device/code` issuance + per-user concurrent-pending cap",
   `spec/SPEC_COWORK_41B_FIXES.md:34`) as out of its lot; it is not yet implemented anywhere and
   41c adopts it as a requirement rather than leaving it open again.
2. The device signs a domain-separated, version-prefixed payload —
   `cowork-enroll-v1:${deviceCode}.${serverNonce}` (UTF-8, literal `.` separator, no other
   encoding) — with its private key and must present that signature (field `proof`) on
   `POST /auth/device/poll` requests. The server verifies the signature against the staged
   `devicePublicKey` **before** it will return `status: 'approved'` — an approved-but-unproven poll
   returns a distinct status (**PROPOSAL:** `proof_required`) rather than tokens. This is D7's
   "proof of possession on enrollment." The `cowork-enroll-v1:` prefix exists so this signature can
   never be replayed as a valid signature for a different signed-payload shape in this system (see
   the matching prefix on the lease-acknowledgement payload, §4.2).
3. On `POST /auth/device/approve` (still requires the human's app session, unchanged surface at
   `api/src/routes/auth/device.ts:130-168`), the approval UI is extended to display a **device
   fingerprint** derived deterministically from `devicePublicKey` alongside the existing `user_code`
   and device name, plus an explicit "did you start this pairing?" confirmation — the same control
   already shipped for device-code phishing on the pairing page
   (`ui/src/routes/auth/devices/pair/+page.svelte`, `en.json:1607`, documented in
   `spec/SPEC_COWORK_41B_FIXES.md:34`). **PROPOSAL, revised for strength:** the earlier draft of
   this design proposed "first 8 hex chars of SHA-256" (32 bits) — that is grindable
   (~2^32 attempts) for an attacker who can generate many candidate key pairs offline and pick one
   whose fingerprint collides with a legitimate device's displayed value. This design instead
   requires **at least 64 bits** of digest material, rendered so a human can actually compare it
   (e.g. word-encoded, not raw hex) rather than a truncated hex prefix, and specifies the **exact
   input bytes** as the raw SPKI-encoded public key (not the raw key bytes alone) so the same
   fingerprint is reproducible byte-for-byte on both the console the binary prints to and the
   approval UI — an ambiguity between "raw key" and "SPKI-encoded key" would silently break
   cross-surface comparison. Framed against the threat this addresses (study §5, "enrollment
   phishing"): this **raises the bar** against key-substitution attacks when the human is looking at
   the legitimate approval console — it does not close the threat outright. It does nothing against
   a human who is tricked into approving without comparing the fingerprint at all, and nothing
   against an attacker who controls the channel the binary's own fingerprint is displayed on (e.g. a
   compromised terminal). The "did you start this?" confirmation and the rate limit in step 1 are
   the controls that address the higher-volume/automated variants of the same threat; none of the
   three is sufficient alone.
4. Only when (a) the human has approved **and** (b) the device has proven possession of the staged
   public key does `pollDeviceCode`-equivalent logic mint the session token pair **and** commit the
   staged identity into the durable registry (§3) as an `active` device row. A pending identity that
   never proves PoP expires with its device-code entry (existing TTL semantics,
   `api/src/services/device-code-store.ts:35,62-64`) and is never committed.

### Re-enrollment of an existing `deviceId` — PROPOSAL

Fact 7 (§1) is a **verified gap**: the CLI never persists/refreshes a session, so every restart
re-runs the full device-code handshake (`packages/cowork-desktop/src/cli/run.ts:78-99`). Once this
branch's device identity is durable, "the same `deviceId` shows up again at
`POST /auth/device/code`" becomes the **routine case**, not an edge case, and §2.1 steps 1-4 above
only describe first-ever enrollment of a brand-new `deviceId`. This design specifies the four
outcomes a repeat `deviceId` must produce:

- **(a) Idempotent re-enroll (same key).** If the presented `deviceId` already resolves to an
  `active` `coworkDevices` row AND the enrollment request's PoP signature (step 2 above) verifies
  against that row's **already-stored** `publicKey`, the server treats this as a refresh, not a new
  identity: it re-issues session tokens through the normal poll/approve cycle without requiring a
  new human approval and without mutating `publicKey` or `publicKeyFingerprint`. This is the path
  that makes durable identity actually valuable across restarts.
- **(b) Key rotation (same `deviceId`, different key).** If the presented `deviceId` resolves to an
  `active` row but the enrollment request carries a **different** `devicePublicKey`, the server
  must not silently accept it as the new identity — an attacker who somehow learns a legitimate
  `deviceId` could otherwise substitute their own key and hijack that identity going forward. This
  design requires **either** (i) proof of possession of the **old** key over the rotation challenge
  (so the outgoing key authorizes its own replacement), **or** (ii) a fresh human approval bound to
  `userId` exactly like first-ever enrollment (step 3 above), clearly labeled in the approval UI as
  "this replaces an already-enrolled device's key," not as a routine pairing. Which of the two (or
  both) is required is **OQ-9** — this design does not bake that policy choice.
- **(c) Cross-user `deviceId` collision → REJECT.** If the presented `deviceId` resolves to an
  `active` row owned by a **different** `userId` than the human who ultimately approves, the
  request is rejected outright — never silently reassigned. `deviceId` is client-generated (UUIDv4)
  and therefore not itself a security boundary; the commit step (step 4 above) is guarded by
  matching `userId`, not by trusting the claimed `deviceId` alone.
- **(d) Revoked-`deviceId` reuse → REJECT.** If the presented `deviceId` resolves to a `revoked`
  row (§2.2), enrollment is rejected — a revoked device cannot re-enroll itself back into `active`
  by simply repeating the device-code flow with its still-held private key. Un-revoking a device (if
  ever needed) is an explicit administrative action outside this branch's UI scope, not a side
  effect of re-enrollment.

**Dependency on BR-41d's CLI refresh (C14).** This subsection makes re-enrollment *safe*, but it
does not by itself make identity durability *felt* by the end user: fact 7
(`packages/cowork-desktop/src/cli/run.ts:78-99`) means the CLI still runs the full device-code
handshake — including the human "did you start this?" approval click (step 3 above) — on **every
process restart**, because it never calls the bridge's already-implemented refresh path
(`packages/cowork-bridge/src/auth/session-auth.ts:187-198`). Case (a) above removes the
*key-rotation* friction from a repeat handshake, but a human still has to click approve every time
until the CLI is fixed to attempt session refresh before falling back to a fresh handshake. The
benchmark study's boundary register already places `cli/**` under BR-41d
(`SPEC_STUDY_COWORK_COMPUTER_USE_BENCHMARK.md:402`, cited at the top of this spec), so this branch
does not implement the CLI-side fix — but it is called out here because it directly caps the
practical value of durable identity until it lands. **OQ-10** asks the architect to confirm
ownership and sequencing: is CLI refresh a hard prerequisite that should gate BR-41c's identity
value being realized, or an independent BR-41d fast-follow that can land after 41c/41d ship?

### Residual risk — device-key custody

The device private key generated above is this design's entire trust anchor: every PoP signature
(enrollment, re-enrollment, lease acknowledgement) is only as strong as that key's secrecy. It is
persisted as a plain file (`device-identity.json`, `0o600`) through the same `StorageAdapter`
fallback the session token already uses — OS-level protection (Windows Credential Manager/DPAPI) is
explicitly deferred (§6, mirroring the existing refresh-token deferral, **C13**). Two consequences
follow directly and are **not mitigated by anything in this design**:

- **Local-file-read attacker.** Any actor with read access to the file (malware running as the same
  OS user, a misconfigured backup, a support technician) can exfiltrate the key and impersonate the
  device indefinitely — including passing PoP on enrollment refresh and lease acknowledgement —
  until the legitimate user notices anomalous behavior and revokes the device (§2.2). There is no
  cryptographic distinction between the legitimate binary and a copy of the key running elsewhere.
- **Cloned-file "impersonation."** If the file is copied to a second machine (deliberately, or via a
  compromised backup/sync tool) and run there, both copies present valid signatures. The presence
  table (§3.1) has last-writer-wins semantics on `lastSeenAt`/`status`, so nothing in this design
  raises an anomaly signal when the same `deviceId` starts reporting presence from two hosts — no
  session/IP/fingerprint correlation is proposed anywhere in this branch.

Neither of these is a regression versus today's session-token-only model (fact 8 has the same
property for the bearer token), but this design **introduces a new, longer-lived secret** without
introducing new protection for it, so it is worth stating plainly: **this design is not
local-attacker-resistant, and does not detect device cloning.** **OQ-11** asks the architect whether
pulling OS-level key protection into 41c's scope (rather than deferring it alongside the
refresh-token OS-cred-store work) is warranted, given it caps what 41d/41e can assume about "the
device" being a single, exclusive actor — or whether 41c should ship as designed with this
limitation explicitly documented for 41d/41e to inherit knowingly.

### 2.2 Revocation — PROPOSAL

- A `cowork_devices` row (§3) carries `status: 'active' | 'revoked'`. Revocation is user-initiated
  (Settings surface, out of this branch's UI scope — see non-goals) or admin-initiated.
- Revoking a device immediately (a) rejects any further registry mutation referencing that
  `deviceId` (§3.2 ownership check), (b) rejects any further lease issuance targeting it, and (c)
  transitions any of its non-terminal leases to `revoked` (§4).
- Revocation does **not** retroactively invalidate the user's existing bearer session token (no
  session-to-device binding exists to revoke — see fact 8 and §6 boundary). This asymmetry is
  flagged as **OQ-6**. Combined with the DB-lookup-only ownership binding on presence mutations
  (§3.2, **OQ-4**): a revoked device's workstation, if it still holds a valid bearer session token,
  can continue calling `register`/`keepalive`/`unregister` for **other, still-active** `deviceId`s
  owned by the same user (those calls check `deviceId` ownership and status, not which device is
  making the HTTP request) and can still read that user's lease queue over the user-scoped read
  path (§5.3) — it just cannot **acknowledge** a lease, because acknowledgement requires the
  now-revoked device's own key, which is a separate, still-valid secret from the bearer token.
  Revoking a `cowork_devices` row does not revoke the ability to *observe and interfere with*
  presence; it only revokes the ability to *consume* a lease as that device.

## 3. Durable registry

### 3.1 Persistence approach — PROPOSAL

Both the device-code pending store (fact 4) and the presence registry (fact 3) are process-local
`Map`s today. NOW-1 requires the registry to survive an API restart. This branch proposes **one**
planned migration (`api/drizzle/NNNN_cowork_device_identity.sql`, file not written in this branch)
introducing three tables in `api/src/db/schema.ts`, following the existing naming and index
conventions used by `llmProviderAccounts` / `llmAccountLeases`
(`api/src/db/schema.ts:493-560`) and `extensionToolPermissions`
(`api/src/db/schema.ts:960-979`):

```
// Drizzle schema SKETCH — illustrative shape only, not final column set.

export const coworkDevices = pgTable('cowork_devices', {
  id: text('id').primaryKey(),                          // == client-generated deviceId
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  deviceName: text('device_name'),
  publicKey: text('public_key').notNull(),               // base64url SPKI/JWK
  publicKeyFingerprint: text('public_key_fingerprint').notNull(),
  capabilities: jsonb('capabilities').notNull().default(sql`'[]'::jsonb`),
  status: text('status').notNull().default('active'),    // 'active' | 'revoked'
  enrolledAt: timestamp('enrolled_at', { withTimezone: false }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: false }),
}, (table) => ({
  userIdx: index('cowork_devices_user_idx').on(table.userId, table.status),
  fingerprintIdx: index('cowork_devices_fingerprint_idx').on(table.publicKeyFingerprint),
}));

export const coworkDevicePresence = pgTable('cowork_device_presence', {
  deviceId: text('device_id').primaryKey().references(() => coworkDevices.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').notNull().default('active'),    // 'active' | 'disconnected'
  connectedAt: timestamp('connected_at', { withTimezone: false }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: false }).notNull().defaultNow(),
}, (table) => ({
  userIdx: index('cowork_device_presence_user_idx').on(table.userId, table.status),
}));

export const coworkDeviceLeases = pgTable('cowork_device_leases', {
  id: text('id').primaryKey(),                            // leaseId
  deviceId: text('device_id').notNull().references(() => coworkDevices.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  turnRef: text('turn_ref').notNull(),                     // opaque chat-turn/task reference (41d-owned)
  nonce: text('nonce').notNull(),
  scope: jsonb('scope'),                                   // RESERVED, nullable — see OQ-12; not
                                                             // interpreted by 41c beyond storing it
  status: text('status').notNull().default('issued'),      // see §4 state machine
  issuedAt: timestamp('issued_at', { withTimezone: false }).notNull().defaultNow(),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: false }),
  consumedAt: timestamp('consumed_at', { withTimezone: false }),
  expiresAt: timestamp('expires_at', { withTimezone: false }).notNull(),
}, (table) => ({
  deviceStatusIdx: index('cowork_device_leases_device_status_idx').on(table.deviceId, table.status),
  expiresIdx: index('cowork_device_leases_expires_idx').on(table.expiresAt),
  // Issuance idempotency (see §4.1): at most one non-terminal lease per (deviceId, turnRef), so a
  // retried issueLease() call for the same turn cannot double-issue.
  nonTerminalUnique: uniqueIndex('cowork_device_leases_device_turn_unique')
    .on(table.deviceId, table.turnRef)
    .where(sql`status IN ('issued', 'acknowledged')`),
}));
```

`coworkDevices` is the durable identity anchor (§2). `coworkDevicePresence` is the durable
replacement for `desktop_cowork` entries in `tab-registry.ts` — **PROPOSAL:** browser sources
(`chrome_plugin`, `bookmarklet`) are explicitly left untouched in the existing in-memory
`tab-registry.ts`; only `desktop_cowork` presence moves to this durable table. `deviceId` is the
primary key (one presence row per device — there is exactly one durable presence state per
enrolled device, so a separate surrogate `id` added nothing). This keeps the branch scoped to
device identity and avoids touching browser-tab code that a different lane owns (see OQ-2 on
whether the transport routes should also move out of `chrome-extension.ts`, and OQ-2's extension on
unifying this table with the in-memory browser-tab map at read time). `coworkDeviceLeases` is the
lease state machine (§4); its `scope` column is reserved but not yet given semantics — see OQ-12.

### 3.2 Ownership-checked mutations — PROPOSAL

Every registry mutation for a `desktop_cowork` device must verify **both**:

1. **User binding:** the authenticated `user.userId` (from `requireAuth`,
   `api/src/middleware/auth.ts:106-117`) matches `coworkDevices.userId` for the referenced
   `deviceId`.
2. **Device-key binding:** the referenced `deviceId` resolves to an `active` row in `coworkDevices`
   — i.e., the caller is presenting a `deviceId` that was actually committed through the PoP-verified
   enrollment flow in §2, not an arbitrary string. This closes **C10**: today `keepalive`/`unregister`
   accept any `tab_id` string with no existence check at all
   (`api/src/routes/api/chrome-extension.ts:74-92`).

This is a DB-lookup-level binding check (deviceId → owning user, deviceId → enrolled/active), not a
live cryptographic challenge on every keepalive call — **OQ-4** asks the architect to ratify or
reject that trade-off; live signature verification is reserved by this design for the two moments
the task brief calls out explicitly: enrollment (§2.1) and lease acknowledgement (§4.2).

`register` additionally requires that the presented `deviceId` already exists as an `active`
`coworkDevices` row (i.e., presence registration is downstream of identity enrollment — a device
cannot appear in the presence table without first completing the PoP-verified handshake).

## 4. Targeted lease

### 4.1 Model

A lease is the durable, single-target authorization unit a chat turn uses to address exactly one
device. Per decision **D2** (study §7: "explicit device plus short-lived capability lease... never
broadcast"), a lease is issued to **one** `deviceId` by construction — there is no multi-device
broadcast to arbitrate between. "Single-winner" and "no cross-device consumption" are therefore
enforced by two independent mechanisms, not by a race between multiple holders:

- **Targeting is exclusive at issuance:** the lease row's `deviceId` is fixed at creation; only that
  device is ever a legitimate audience for it (§5, delivery contract).
- **Acknowledgement requires the targeted device's private key:** a different device — even another
  device enrolled by the same user — does not hold the private key for the targeted `deviceId` and
  therefore cannot produce a valid acknowledgement signature (§4.2), even if it somehow observes the
  `leaseId`/`nonce` (e.g., a leaked value, a misdirected client). This is the actual enforcement of
  "same-user devices cannot consume each other's calls" (study, required-gap register).
- **Atomicity guards against replay of the legitimate device's own acknowledgement:** the state
  transition is a single conditional `UPDATE ... WHERE id = $leaseId AND status = 'issued'`
  (mirroring the existing single-use consumption pattern in
  `api/src/services/device-code-store.ts:157-191`), so a duplicated/retried ack cannot be applied
  twice.
- **Issuance is atomic and idempotent, not a race to be arbitrated after the fact:** `issueLease`
  performs its eligibility check (target device active and presence-fresh — §4.2) and the row
  insert as a single atomic operation (transaction, or a conditional `INSERT ... SELECT` guarded by
  the eligibility predicate), so a device that is revoked or goes stale between the check and the
  insert cannot receive a lease — this closes the TOCTOU window between "check eligible" and
  "issue." The same call is also idempotent per `(deviceId, turnRef)` (§3.1, §4.2) so a retried
  `issueLease` invocation — the caller's normal failure-recovery path, not an attack — cannot
  silently double-issue a lease for the same logical turn.

### 4.2 State machine

```
issued --(device presents valid signature over {leaseId, nonce}, before expiry)--> acknowledged
issued --(expiresAt reached, unacknowledged)--> expired
acknowledged --(41d reports execution complete)--> consumed        [41d-owned transition, out of scope]
acknowledged --(execution deadline reached)--> expired              [41d-owned transition, out of scope]
{issued, acknowledged} --(user stop / device revoked)--> revoked
```

- **issued:** created by the (41d-owned, not designed here) turn-to-device targeting call. BR-41c's
  contribution is the primitive: `issueLease(userId, deviceId, turnRef) -> {leaseId, nonce,
  expiresAt}`, which fails closed unless, in one atomic check-and-insert (§4.1), `deviceId` is an
  `active` device owned by `userId` **and** has an `active` `coworkDevicePresence` row **and** that
  row's `lastSeenAt` is fresh (`lastSeenAt > now - 45s`, matching the existing keepalive/eviction
  cadence: 15s keepalive interval, `packages/cowork-desktop/src/registry/registry-client.ts:10`;
  45s eviction window, `api/src/routes/api/chrome-extension.ts:83`). Durable presence rows do not
  self-expire the way today's in-memory `Map` does on process restart (§3.1); without this
  freshness predicate, a device that crashed without unregistering would still look "active" to
  `issueLease` indefinitely, and a lease would be issued to a device that will never see it (dead
  eviction is otherwise deferred to the reaper, **OQ-13**, which runs on a slower cadence than a
  targeting call can afford to wait for). **Retry semantics:** because `(deviceId, turnRef)` is
  unique among non-terminal leases (§3.1), calling `issueLease` again for a turn that already has an
  `issued` or `acknowledged` row returns the **existing** lease (`{leaseId, nonce, expiresAt}` of
  the row already in flight) rather than erroring or creating a second one; a caller only gets a new
  lease once the prior one reaches a terminal state.
- **acknowledged:** the device presents a bearer-authenticated request — `user.userId` must equal
  `coworkDevices.userId` for the referenced `deviceId`, the same user-binding check as §3.2, not a
  separate trust boundary for leases — and signs the domain-separated payload
  `cowork-lease-ack-v1:${leaseId}.${nonce}` with its enrolled private key. The server verifies the
  signature against `coworkDevices.publicKey` for that `deviceId`, and only transitions `issued ->
  acknowledged` if **all** of: the row is still `issued`, `now < expiresAt`, **and** the owning
  `coworkDevices` row is still `status = 'active'` (a join/subquery on `coworkDevices.status`
  evaluated at acknowledgement time, not assumed from the device having been active at issuance —
  this closes the revoke-after-issue race: a device revoked between issuance and acknowledgement
  must not be able to acknowledge). This is the "proof-of-possession on every lease acknowledgement"
  requirement (D7) — distinct from, and in addition to, the enrollment-time PoP in §2.1, and kept
  distinguishable from it by the `cowork-lease-ack-v1:` prefix (mirrors `cowork-enroll-v1:`, §2.1
  step 2) so the two signature types can never be confused or replayed against each other.
- **consumed / expired / revoked:** terminal states. `consumed` is set by BR-41d once the device's
  tool-result round-trip for that turn completes (out of scope here — BR-41c only reserves the
  column and the transition contract). `expired` is set by a reaper (background sweep or lazy
  check-on-read — mechanism and ownership are **OQ-13**) once `expiresAt` passes without
  acknowledgement, or once an acknowledged lease exceeds a longer execution deadline (41d's
  concern). `revoked` is reachable from either non-terminal state via user stop or device
  revocation (§2.2), through a primitive BR-41c exposes: `revokeLease(leaseId, reason) ->
  {status: 'revoked'}` (also listed in §6) — since 41c owns the lease state machine, it is the one
  that must expose this transition, not 41d/41e reimplementing it against the table directly.

### 4.3 Anti-replay rule

- `nonce` is single-use, cryptographically random, and at least 128 bits (matching the enrollment
  `serverNonce` requirement, §2.1 step 1); the signed payload (`cowork-lease-ack-v1:${leaseId}.${nonce}`,
  §4.2) binds the signature to exactly one lease under this design's domain-separated scheme, so a
  captured signature cannot be replayed against a different lease even if `leaseId`s were guessable,
  nor confused with an enrollment-PoP signature.
- A lease can be acknowledged **at most once**: the conditional `UPDATE ... WHERE status='issued'`
  makes the issued→acknowledged transition atomic; any duplicate/retried acknowledgement request
  (same signature resubmitted, or a second request racing the first) observes `status != 'issued'`
  and is rejected, not silently accepted.
- An `expired` or `consumed` lease can never be acknowledged (status guard is unconditional on the
  transition, not time-window-based only — even a delayed valid signature arriving after the reaper
  has marked the row `expired` is rejected because the `WHERE status='issued'` predicate no longer
  matches).

## 5. Delivery contract (D8)

Per **D8** (study §7: "durable queue/lease is source of truth; device-filtered SSE is low-latency
notification; polling is reconnect fallback"), this branch specifies three channels for the *same*
underlying `coworkDeviceLeases` rows — it does not invent a second data model for delivery. **Read
carefully against §4.2/§4.3: acknowledgement (a valid signature over
`cowork-lease-ack-v1:${leaseId}.${nonce}`) is the ONLY device-level guarantee anywhere in this
design.** None of the three channels below prove that the entity reading a `leaseId`/`nonce` pair is
the targeted device — they are gated by the same bearer-session/user-ownership check used
throughout §3.2, which (per **OQ-4**) is a DB lookup, not a live signature. A same-user sibling
device, or anything holding that user's bearer token, can observe a lease's `leaseId` and `nonce`
through channels 2 or 3 below; it just cannot turn that observation into a valid acknowledgement,
because it does not hold the targeted device's private key. This is by design (§4.1) but is easy to
misread as "the device only sees its own leases" if the delivery layer is read in isolation from
the acknowledgement layer — it does not; only acknowledgement is device-proven. The implementation
of the SSE endpoint itself (and the device consumption loop that calls it) is **BR-41d's**, per the
study's boundary register (`SPEC_STUDY_COWORK_COMPUTER_USE_BENCHMARK.md:402`); this branch
specifies the contract/shape only (channel-selection rule, gating semantics, OQ-5), not the route
implementation.

1. **Durable device queue = source of truth.** A device's pending work is exactly the set of
   `coworkDeviceLeases` rows with `deviceId = <this device>` and `status = 'issued'`. No separate
   queue table is introduced; the lease table itself is the queue. This guarantees a device that was
   offline when a lease was issued can still discover and acknowledge it up to `expiresAt`.

2. **Device-filtered SSE = low-latency notify.** Today's `GET /streams/sse`
   (`api/src/routes/api/streams.ts:242-323`) has no `deviceId` dimension at all — it resolves a
   target *workspace* and authorizes chat/organization/folder/initiative/job streams against
   `user.userId` (fact 6). **PROPOSAL:** a device-scoped notification surface that:
   - requires the connecting caller to present a `deviceId` and to be the enrolled owner of an
     `active` device (same ownership check as §3.2), not merely "any authenticated user for this
     workspace";
   - subscribes only to `pg_notify`-style events scoped to that exact `deviceId`, mirroring the
     existing channel-per-concern pattern already used for `stream_events` / `job_events` /
     `organization_events` (`api/src/routes/api/streams.ts:775-784`) — e.g., a new
     `cowork_device_lease_events` channel whose payload carries `device_id` so the handler can
     filter before ever touching the DB (same shape as the existing `onNotification` dispatch at
     `api/src/routes/api/streams.ts:667-772`);
   - is a **design-level channel-selection rule**, not a code change: "a device subscribes only to
     its own leases" means the server must reject or silently ignore any notification whose
     `device_id` does not equal the connecting device's own `deviceId`, symmetric to how
     `isStreamAllowed` already gates organization/folder/initiative streams by workspace membership
     today (`api/src/routes/api/streams.ts:325-372`).
   - **OQ-5** asks whether this reuses `/streams/sse` with an added `deviceId` filter dimension or
     is a dedicated `/devices/:deviceId/leases/sse` endpoint — the two have different auth-model
     implications (device-bound bearer vs. today's browser-session-shaped user auth) and should be
     ratified by the architect, not assumed here.

3. **Polling = reconnect fallback.** A device that missed its notification (offline, connection
   drop, or simply never opened the low-latency channel) must be able to catch up by asking "what is
   `issued` for me right now" — a bounded, ownership-checked read against `coworkDeviceLeases`,
   directly analogous to the existing `GET /streams/active` pattern
   (`api/src/routes/api/streams.ts:220-239`). This is a fallback path, not the primary channel; a
   device that only ever polls still functions, just at reduced latency. **Ownership-checked here
   means user-scoped, not device-scoped** — mirroring `/streams/active`'s existing shape, the query
   is naturally "which leases belong to a device owned by this bearer-authenticated user," which, if
   implemented as-is, lets any of the user's devices (or any bearer-token holder for that user) read
   `leaseId`/`nonce` for leases addressed to a *different* one of that user's devices. Whether the
   poll endpoint should additionally require the caller to specify and be bound to one `deviceId`
   (narrower, matches channel 2's SSE gating) is folded into **OQ-4**'s ratification, since it is the
   same DB-lookup-vs-signature trade-off; regardless of the answer, this does not weaken §4.2's
   acknowledgement guarantee (previous paragraph).

## 6. Boundaries with adjacent lanes

These are stated so this branch does not silently absorb work that belongs elsewhere. None of them
are designed here.

- **auth/39etc.** Binding the *bearer session token* itself to a device (DPoP-style, so a stolen
  session token cannot be replayed from a different machine) is explicitly **not** designed in this
  branch. `userSessions` has no `deviceId` FK today (`api/src/db/schema.ts:185-201`, fact 8); this
  branch's device identity is anchored purely by the device's own Ed25519 key pair, verified via
  explicit signature fields on specific requests (enrollment PoP, lease-ack PoP) — independent of
  whatever the bearer token is. OS-level credential storage (Windows Credential Manager/DPAPI) for
  either the refresh token (already deferred, **C13**) or the new device private key is also **later**
  work; this branch keeps using the existing file-backed `StorageAdapter` fallback (§2.1).
- **a2a-cli / remote sessions.** Out of scope. This branch's lease primitive addresses one
  user-owned Cowork workstation; it says nothing about cross-host or cross-agent session brokering.
- **The broker / tool loop (D1, owned by BR-41d).** Per **D1** (study §7: option C, "new
  capability-broker/orchestrator between chat and devices"), BR-41d owns turn-to-lease targeting
  logic, server-side desktop-tool injection, the device's SSE/queue *consumption* loop, the SSE
  endpoint implementation itself (§5), and the canonical tool-result contract. BR-41c's
  contribution ends at exposing `issueLease`, `acknowledgeLease`, `revokeLease` (§4.2 — user stop
  and BR-41e emergency stop are both expected to call this rather than mutate
  `coworkDeviceLeases` directly), the eligibility query ("which of this user's devices are active
  and own which capabilities"), and the delivery primitives in §5. BR-41c does not touch
  `packages/chat-server/src/index.ts`, `api/src/services/chat-service.ts`, or
  `packages/cowork-desktop/src/runner/**`.
- **Consent/approval UI (BR-41e).** The enrollment device-fingerprint display and "did you start
  this?" confirmation (§2.1 step 3) render on the same pairing/device-management UI surface the
  study's boundary register assigns to BR-41e
  (`SPEC_STUDY_COWORK_COMPUTER_USE_BENCHMARK.md:403`, "targeted UI pairing/device-management
  surfaces"). This branch specifies what the enrollment surface must display and confirm — it is
  intrinsic to enrollment, not deferrable — but the UI component work itself, and any future
  device-management surface (e.g. listing/revoking devices, §2.2), is BR-41e's to build.

## 7. Safety invariants and the CI tests that must eventually prove them

Listed at file granularity per the task brief — **not written in this branch**.

| Invariant | Where it must be proven |
|---|---|
| No lease is issued without an eligible (active, owned, presence-active) device | `api/tests/unit/cowork-device-lease-service.test.ts` (new) |
| A device cannot acknowledge a lease targeted at a different device | `api/tests/api/cowork-device-leases.spec.ts` (new) — S5-equivalent case |
| An expired lease cannot be acknowledged, even with a valid signature | `api/tests/api/cowork-device-leases.spec.ts` (new) |
| A duplicate/replayed acknowledgement of an already-acknowledged lease is rejected | `api/tests/api/cowork-device-leases.spec.ts` (new) — S6-equivalent case |
| `register`/`keepalive`/`unregister` reject a `deviceId` not owned by the caller | `api/tests/unit/cowork-device-registry.test.ts` (new, successor pattern to `api/tests/unit/tab-registry.test.ts`) |
| `register`/`keepalive`/`unregister` reject a `deviceId` that is not an enrolled/active device | `api/tests/unit/cowork-device-registry.test.ts` (new) |
| Enrollment cannot complete (tokens minted, device committed) without a valid PoP signature | `api/tests/api/auth-device-code.spec.ts` (extend existing suite) |
| A revoked device cannot register, keepalive, receive a new lease, or acknowledge an outstanding one | `api/tests/api/cowork-device-leases.spec.ts` + `api/tests/unit/cowork-device-registry.test.ts` |
| The registry and lease store survive a process restart (no in-memory `Map` as source of truth) | Integration-level: a test that re-instantiates the DB-backed store against a fresh client/connection and reads state written by a prior instance, proving no reliance on process-local state (new, location TBD with architect — likely `api/tests/integration/cowork-device-durability.spec.ts`) |
| Device-scoped delivery channel never emits a lease event for a different device | `api/tests/api/streams.spec.ts` (extend) or a dedicated `api/tests/api/cowork-device-sse.spec.ts` (new), pending OQ-5 |
| Re-enrolling an already-`active` `deviceId` under a different `userId` is rejected (cross-user collision) | `api/tests/api/auth-device-code.spec.ts` (extend) |
| Re-enrolling an already-`active` `deviceId` with a different `devicePublicKey` cannot complete without the rotation proof this branch requires (OQ-9) | `api/tests/api/auth-device-code.spec.ts` (extend) |
| A retried `issueLease` call for the same `(deviceId, turnRef)` returns the existing lease, never a second row | `api/tests/unit/cowork-device-lease-service.test.ts` (new) |
| A device revoked between issuance and acknowledgement of a lease cannot acknowledge it | `api/tests/api/cowork-device-leases.spec.ts` (new) |

## 8. Explicit non-goals

- No tool loop, no server-side desktop-tool injection into the chat agent loop (BR-41d).
- No local consent UI, no sensitive-action confirmation, no emergency stop (BR-41e).
- No isolated execution broker/VM/sandbox (BR-41h).
- No OS-backed credential store implementation (Windows Credential Manager/DPAPI) for either the
  refresh token or the new device private key — both continue to use the existing file-backed
  fallback.
- No code signing or durable release/distribution channel (BR-41f).
- **No product code changes in this branch.** Every interface, table sketch, and endpoint extension
  above is a design proposal for a follow-on implementation branch, not a description of code that
  exists after this branch merges.

## 9. Open questions for the architect

- **OQ-1 (D7 — algorithm choice).** This design proposes Ed25519 for the device key pair. Ratify or
  override (e.g., ECDSA P-256 for broader legacy WebCrypto/host compatibility if a non-Node desktop
  host is anticipated sooner than expected). This also covers the public-key export format (base64url
  SPKI vs. JWK, §2.1).
- **OQ-2 (routing/transport placement, extended to read-path unification).** `chrome-extension.ts`
  currently hosts `desktop_cowork` register/keepalive/unregister alongside actual Chrome-extension
  tab routes (`api/src/routes/api/chrome-extension.ts:44-92`), and `SPEC_COWORK.md §6` explicitly
  deferred "extend `tab-registry` vs. sibling `device-registry`" to BR-41a with a stated default of
  "extend." Given C10 and the durable-table split in §3.1, should BR-41c's implementation branch
  also relocate device-specific routes out of a file literally named for the Chrome extension (e.g.
  new `/devices/*` routes), or keep the existing path prefix for backward compatibility with the
  already-published `RegistryClient` (`packages/cowork-desktop/src/registry/registry-client.ts:65,96,114`)?
  **Related:** once `desktop_cowork` presence lives in the durable `coworkDevicePresence` table
  (§3.1) while browser sources (`chrome_plugin`, `bookmarklet`) stay in the in-memory
  `tab-registry.ts` `Map`, "what can this user address right now" is answered by **two different
  readers hitting two different storage shapes**, not one: BR-41d's desktop-targeting/eligibility
  path reads the durable table, while wherever chat UI lists reachable targets for a human to pick
  reads the in-memory map via `listTabs`/`resolveTarget` (`tab-registry.ts:89-112`) as it does
  today. Nothing in this design unifies those two reads into one seam. Should this branch specify a
  combined read (a single query/view presenting browser tabs and desktop devices together), or is
  it acceptable for the two target categories to remain genuinely separate surfaces, composed (if
  at all) by whichever caller needs both?
- **OQ-3 (PoP transport).** §2.1 proposes carrying the enrollment PoP signature as an extra field on
  the existing `POST /auth/device/poll` request/response cycle rather than adding a dedicated
  `/auth/device/prove` endpoint. Ratify or prefer the dedicated-endpoint alternative (clearer
  failure semantics, but a new public unauthenticated route).
- **OQ-4 (security consequence of the DB-lookup binding, not just keepalive PoP cost).** §3.2
  proposes DB-lookup ownership binding (not a live signature) for
  `register`/`keepalive`/`unregister`, and §5's poll-based delivery fallback inherits the same
  user-scoped (not device-scoped) binding. Stated as a security consequence rather than a CPU/latency
  trade-off: **any holder of the user's bearer session token — a browser session, a stolen token, or
  a sibling device enrolled by the same user — can forge presence for, keepalive, or unregister any
  of that user's `deviceId`s** (enumerable via the user's own device list), enabling misdirected
  lease targeting or a denial-of-service against the real device; and the same binding lets a
  sibling device (or bearer-token holder) read another device's `leaseId`/`nonce` over the poll
  fallback (§5.3). Consumption remains blocked either way — acknowledgement is the only
  device-proven action anywhere in this design (§5) — but presence and read-path manipulation are
  not. Combined with **OQ-6**: a revoked device whose bearer token is still valid retains this
  presence-manipulation and lease-reading ability for the user's *other* devices even after its own
  revocation (§2.2). Ratify this reading of D7's boundary (crypto only at enrollment and lease-ack)
  as an accepted residual risk, or require signed presence mutations too (higher CPU/latency cost at
  the existing 15s keepalive cadence, `packages/cowork-desktop/src/registry/registry-client.ts:10`)
  and/or a device-scoped (not user-scoped) poll endpoint.
- **OQ-5 (D8 — SSE surface).** §5.2 flags reusing `/streams/sse` with a `deviceId` filter dimension
  vs. a dedicated device-scoped SSE endpoint. The two imply different auth-context shapes (today's
  `/streams/sse` assumes a browser-session-shaped `user` context with workspace resolution,
  `api/src/routes/api/streams.ts:207-218,244-245`; a headless device has no workspace-selection UX).
  Ratify the surface before BR-41d builds its consumption loop against it.
- **OQ-6 (revocation asymmetry).** §2.2 notes that revoking a `cowork_devices` row does not revoke
  the user's underlying bearer session (no FK exists to cascade through, fact 8). Is a session-level
  consequence required for device revocation in BR-41c's scope, or is "no new leases, no registry
  mutations, no lease acknowledgements" a sufficient revocation contract until auth/39etc ships
  session-device binding? See **OQ-4** for the residual presence-manipulation risk this leaves open.
- **OQ-7 (migration ownership / package placement).** §3.1 sketches the three new tables directly in
  `api/src/db/schema.ts`, following the existing pattern (all Cowork/registry/session tables already
  live there). Confirm this stays app-owned rather than moving into a `packages/*` extraction, per
  `rules/architecture.md` — "Package extraction must be activated by real app consumption," and
  there is no second consumer for these tables yet.
- **OQ-8 (D12 — BR-41b sequencing).** Confirm BR-41b (local webview) remains gated behind BR-41c +
  BR-41d + BR-41e per the study's recommended sequencing (§6/§9), i.e. this branch's identity/lease
  primitives are a prerequisite, not an optional hardening pass.
- **OQ-9 (re-enrollment — key-rotation proof policy).** The re-enrollment subsection (§2.1) requires
  either proof of the old key or a fresh human approval when a `deviceId` re-enrolls with a
  different `devicePublicKey`, but does not decide which (or both). Ratify: proof-of-old-key only
  (fully automated, but silent if the old key was already compromised), human-approval-only (safe
  against key compromise, but reintroduces a pairing prompt precisely where re-enrollment was meant
  to remove it), or both required together.
- **OQ-10 (CLI refresh ownership / 41c prerequisite, C14).** The re-enrollment subsection (§2.1)
  notes that until the CLI is fixed to attempt session refresh
  (`packages/cowork-bridge/src/auth/session-auth.ts:187-198`) before falling back to a full
  device-code handshake — work the study's boundary register places under BR-41d's `cli/**`
  (`SPEC_STUDY_COWORK_COMPUTER_USE_BENCHMARK.md:402`) — durable device identity still triggers a
  human approval click on every process restart (fact 7, C14). Is CLI refresh a hard prerequisite
  this branch's value depends on — i.e. should BR-41c's ratification be conditioned on BR-41d
  committing to ship it early — or an independent fast-follow that can land after both branches
  ship?
- **OQ-11 (device-key OS protection — pull into 41c scope or defer with documented limitation).**
  The residual-risk note (§2.1) states this design is not local-attacker-resistant and does not
  detect device cloning, because the device private key is file-backed (`device-identity.json`,
  `0o600`) with OS-level protection deferred alongside the refresh-token OS-cred-store work (C13,
  §6). Should 41c's scope widen to include OS-level key protection (Windows Credential
  Manager/DPAPI) given it is the trust anchor every other guarantee in this design (§4) rests on, or
  should 41c ship as designed with this limitation explicitly documented for BR-41d/41e to inherit
  knowingly?
- **OQ-12 (D2 — capability-scoped vs. capability-agnostic lease).** §3.1 reserves a nullable `scope`
  column on `coworkDeviceLeases` rather than leaving no room for it, because D2 names this a
  "capability lease" while the row this design specifies is turn-scoped only (any `active` device
  with the right presence state is eligible, regardless of which capabilities a specific chat turn
  actually needs, §4.1). Should the lease itself carry capability scope (e.g. "this lease only
  authorizes `screen_capture`"), enforced at acknowledgement or consumption time, or is capability
  granularity deliberately left entirely to BR-41d/BR-41e's side of the boundary, with the lease
  staying capability-agnostic and `coworkDevices.capabilities` (§3.1) used only for device
  *selection*, never lease *scoping*?
- **OQ-13 (expiry reaper — mechanism and ownership).** §4.2 leaves the `issued -> expired` and
  `acknowledged -> expired` (execution-deadline) transitions to "a reaper (background sweep or lazy
  check-on-read)" without naming which, or who builds and owns it (41c, since it owns the state
  machine, or 41d, since it is the practical trigger for most reads). Ratify the mechanism and
  owner. **Note for whichever branch implements it:** if the reaper is a background sweep, it must
  be gated by a dedicated env flag OFF in `docker-compose.test.yml` — the api-test stack boots
  `NODE_ENV=development` (not `test`), so a bare `NODE_ENV !== 'test'` guard does not suppress a
  background service there and has caused test-stack interference before.
