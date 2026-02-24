# eIDAS 2.0 / EUDI Wallet — Full Compliance Design

**Date:** 2026-02-21
**Scope:** eguilde_wallet (wallet_provider, pid_issuer/dgep, api_gateway, lotl, qtsp) + eguilde (verifier, interactions, pid-issuer)
**Approach:** Full PKI hardening (Approach C)
**Status:** Design approved, pending implementation

---

## Context

The eGuilde emergency portal uses an internal eIDAS 2.0 ecosystem:
- **wallet.eguilde.cloud** — the wallet backend (api-gateway on egucluster3:8180)
- **egucluster3.eguilde.cloud** — the eguilde portal backend (port 3100)
- Custom **eguilde Android wallet** app (`eguilde_wallet/wallet/`)
- Internal QTSP, LOTL, Certification services — these ARE the national systems

All services are currently running. The goal is to make the full end-to-end flow work correctly and be fully eIDAS 2.0 ARF 2.5.0+ compliant.

---

## Architecture Overview

```
Android Wallet App
    ↕ HTTPS (TLS 1.3)
wallet.eguilde.cloud (nginx reverse proxy at 90.84.228.123)
    ↕
egucluster3:8180 (api-gateway Docker container)
    ↕ PostgreSQL messaging (internal)
dgep:3010  lotl:3002  qtsp:3003  wallet-provider:3210  certification:3001

eguilde portal (egucluster3:3100)
    ↕ HTTPS call to wallet.eguilde.cloud
eguilde verifier ← trust.service.ts → wallet LOTL
```

---

## Active Bugs (Must Fix, Blocking Production)

### Bug 1: `/.well-known/openid-credential-issuer` returns HTTP 500

**File:** `eguilde_wallet/monoback/apps/dgep/src/controllers/messaging.controller.ts:141-150`
**Root cause:** `getOpenidMetadata()` returns `buildCredentialIssuerMetadata()` directly (plain object without `{ success, data }` wrapper). The api-gateway controller at `dgep.controller.ts:143` checks `result.success` which is `undefined` → throws.
**Same bug:** `getWellKnownCredentialIssuer()` at line 278.
**Fix:** Wrap returns in `{ success: true, data: this.buildCredentialIssuerMetadata() }`.
**Impact:** Android wallet cannot discover the issuer — PID issuance completely broken.

### Bug 2: SD-JWT `typ` header is `vc+sd-jwt` instead of `dc+sd-jwt`

**File:** `eguilde_wallet/monoback/apps/dgep/src/services/sd-jwt.service.ts:91`
**Root cause:** `typ: 'vc+sd-jwt'` used. ARF 2.5.0+ mandates `dc+sd-jwt` as the format identifier.
**Also:** `verifySdJwtVc()` at line 348 verifies with `typ: 'vc+sd-jwt'` — must also change.
**Fix:** Change both to `'dc+sd-jwt'`.
**Impact:** Wallets checking the `typ` header will reject the credential.

### Bug 3: `oidc_models` table never created

**File:** `eguilde_wallet/monoback/apps/api-gateway/src/oidc/adapters/pg-adapter.ts:28-50`
**Root cause:** `ensureTableExists()` is called in the constructor (synchronous entry point). Async errors are silently swallowed. After 4+ hours, the table still doesn't exist.
**Fix:** Move to `OnModuleInit` on `OidcModule`, or run `CREATE TABLE IF NOT EXISTS` as a migration before the OidcProvider is initialized.
**Impact:** Entire OIDC server non-functional — no sessions, no tokens, no login flow.

### Bug 4: `createTransaction` stores old `presentation_definition`

**File:** `eguilde/backend/src/verifier/verifier.service.ts:215`
**Root cause:** `def = presentationDefinition ?? this.defaultPresentationDefinition` — always falls back to the PE format. DB stores the wrong format. The wallet request correctly uses `dcql_query` but the stored column is misleading.
**Fix:** Store the DCQL query in the `presentation_definition` column, or add a separate `dcql_query` column.

### Bug 5: DCQL `birthdate` vs `birth_date` mismatch

**File:** `eguilde/backend/src/verifier/verifier.service.ts:97`
**Root cause:** DCQL requests `{ path: ['birthdate'] }` but DGEP issues `birth_date` (with underscore, per ARF Annex 4).
**Fix:** Change DCQL query to request `birth_date`, keeping `birthdate` as optional alias.

### Bug 6: `credential_issuer` trailing slash inconsistency

**Files:** `dgep/messaging.controller.ts:442` adds trailing slash; `sd-jwt.service.ts:95` uses `issuer.id` from config (no trailing slash).
**Root cause:** `iss` claim in credential won't match `credential_issuer` in metadata — the verifier's JWKS lookup will use the wrong URL.
**Fix:** Normalize to `issuer.id` without trailing slash everywhere. The `credential_issuer` in metadata must exactly equal the `iss` claim in issued credentials.

---

## Compliance Hardening

### Fix 7: Trust verification — fail closed

**File:** `eguilde/backend/src/verifier/trust.service.ts:161-164`
**Current:** Returns `true` (allow) when LOTL unreachable.
**Fix:** If cache is empty AND LOTL unreachable → throw `UnauthorizedException`. If cache has a valid entry (even if slightly stale, within 2x TTL) → use cached value. This allows short LOTL outages without breaking prod while still failing closed on first use.

**Same for `checkCredentialStatus` at line 125-129:** Returns `true` on failure. Fix: same grace period approach.

### Fix 8: Android wallet device attestation wiring

**Files:**
- `eguilde_wallet/monoback/apps/api-gateway/src/controllers/attestation-android.controller.ts`
- `eguilde_wallet/wallet/app/` (Android Kotlin source)

**Required:**
1. Android wallet generates device key pair in Android Keystore (hardware-backed)
2. Gets key attestation certificate chain from Android Keystore
3. Sends attestation with credential request
4. api-gateway verifies attestation before forwarding to DGEP

**Note:** For LoA High, hardware-backed keys are required by eIDAS 2.0 ARF Section 5.2.

### Fix 9: `x5c` certificate chain in JWKS

**File:** `eguilde_wallet/monoback/apps/dgep/src/controllers/messaging.controller.ts:315-335`
**Current:** JWKS only exposes the raw JWK, no certificate chain.
**Fix:** Retrieve the QTSP-issued certificate for the issuer key, add `x5c: [base64DerCert, base64IntermedCert, base64RootCert]` to the JWK entry.
**Impact:** Verifiers can do full X.509 chain validation without relying on the LOTL endpoint alone.

### Fix 10: Verifier — X.509 certificate chain validation

**File:** `eguilde/backend/src/verifier/trust.service.ts`
**Add after JWKS fetch:** If the key includes `x5c`, validate:
1. Certificate chain signature integrity (leaf → intermediate → root)
2. Leaf cert validity period (`notBefore` ≤ now ≤ `notAfter`)
3. Key usage extension: `digitalSignature` set
4. Root cert matches a trusted CA in LOTL `trusted_services`
5. OCSP check on leaf cert (soft-fail: if OCSP unreachable, use CRL if present, else skip with warning)

### Fix 11: ETSI TS 119 612 TSL XML endpoint

**File:** `eguilde_wallet/monoback/apps/lotl/src/`
**Add:** A new HTTP endpoint `GET /tsl/ro.xml` (or `GET /tsl`) that:
1. Serializes `trust_lists` + `trusted_services` as ETSI TS 119 612 XML
2. Signs the XML with the QTSP root key
3. Includes `NextUpdate` set to 6 months from now
4. Exposes at `https://wallet.eguilde.cloud/tsl`

This makes your LOTL consumable by external verifiers and demonstrates full eIDAS 2.0 TSL compliance.

### Fix 12: `TimeoutNegativeWarning` in cron schedulers

**Files:** `dgep/pid-provider-bootstrap.service.ts`, `lotl` bootstrap
**Root cause:** A `CronJob` is scheduled with a negative timeout (likely an expression that evaluates to a past date).
**Fix:** Check all cron expressions — replace absolute date expressions with relative ones (`*/24 * * * *` for 24h intervals).

---

## End-to-End Flow: Android Wallet Registration & Login

### Phase 1: PID Issuance (One-time per citizen)

```
1. Admin in eguilde portal:
   POST /api/pid-issuer/offer → creates DGEP citizen + pre-auth code + tx_code (PIN)

2. Email to citizen with:
   - openid-credential-offer://... deep link (or QR code)
   - 6-digit tx_code PIN

3. Android wallet scans QR or opens deep link:
   a. GET /.well-known/openid-credential-issuer → discovers issuer metadata
   b. GET /.well-known/jwks.json → fetches issuer signing key (with x5c)
   c. Validates x5c chain against trusted root CA
   d. User enters tx_code PIN → wallet shows consent screen

4. POST /token:
   grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code
   pre-authorized_code=<code>&tx_code=<PIN>
   → Returns access_token

5. POST /credential:
   format: dc+sd-jwt
   vct: eu.europa.ec.eudi.pid.1
   proof: { proof_type: jwt, jwt: <openid4vci-proof+jwt> }  ← device key + attestation
   Authorization: Bearer <access_token>
   → Returns { format: "dc+sd-jwt", credential: "<issuer-jwt>~<disc>~..~" }

6. Wallet stores credential, displays PID card on home screen
```

### Phase 2: Wallet Login to eguilde Portal

```
1. User visits eguilde portal login → clicks "Login with EUDI Wallet"
2. Frontend: POST /interactions/{uid}/wallet/start
   → Returns { transactionId, qrCodeData }
3. Frontend shows QR code with openid4vp://authorize?request_uri=...&client_id=eguilde-portal

4. Android wallet scans QR:
   a. GET {request_uri} → signed JWT (oauth-authz-req+jwt) with DCQL query
   b. Validates RP JWT signature
   c. Shows consent: "eguilde Portal requests your name, birth date"
   d. User confirms

5. Wallet creates VP token:
   a. Selects matching PID credential (dc+sd-jwt)
   b. Computes disclosures for requested claims only
   c. Creates KB-JWT: { nonce, aud: "eguilde-portal", sd_hash, iat }
   d. Signs KB-JWT with device hardware key
   e. Assembles: <issuer-jwt>~<disc1>~<disc2>~<kb-jwt>

6. POST /api/verifier/wallet/response:
   { vp_token: "...", state: txId }

7. Verifier:
   a. Parses SD-JWT (issuer-jwt + disclosures + KB-JWT)
   b. Checks credential not expired
   c. Fetches JWKS from iss URL, validates issuer signature
   d. Validates x5c certificate chain (if present)
   e. Validates all disclosure hashes against _sd array
   f. Verifies KB-JWT: nonce ✓, aud ✓, sd_hash ✓, iat freshness ✓, device key sig ✓
   g. Checks revocation (status list RFC 9427) — fail closed
   h. Checks LOTL trust — fail closed
   i. Returns verified_claims

8. Frontend polls GET /interactions/{uid}/wallet/status?txId=...
9. On status=completed: POST /interactions/{uid}/wallet/complete
   → oidcService.interactionFinished → OIDC authorization code issued
10. User logged in with acr=urn:eidas:loa:high
```

---

## Certificate Verification Chain (Full PKI)

```
QTSP root CA (self-signed)
  └── Intermediate CA (signed by QTSP root)
       └── DGEP issuer certificate (signed by intermediate)
            ↑ This cert is in x5c in JWKS

Verification at relying party:
1. Extract x5c from issuer JWK
2. Parse each DER certificate
3. Verify chain: leaf.issuer == intermediate.subject, sig verifies with intermediate pubkey
4. Verify chain: intermediate.issuer == root.subject, sig verifies with root pubkey
5. Check leaf notBefore ≤ now ≤ notAfter
6. Check keyUsage: digitalSignature
7. OCSP: GET {leaf.AIA.ocsp}?requestBody → check revocation status
8. CRL fallback if OCSP unavailable
9. Trust anchor: root CA fingerprint must match entry in LOTL trusted_services
```

---

## Files to Modify

### eguilde_wallet (wallet backend — source code, requires CI rebuild)

| File | Change |
|------|--------|
| `apps/dgep/src/controllers/messaging.controller.ts` | Bug 1: wrap metadata returns in `{success,data}`; Bug 2: n/a |
| `apps/dgep/src/services/sd-jwt.service.ts` | Bug 2: `typ: 'dc+sd-jwt'`; Fix 6: normalize issuer URL |
| `apps/api-gateway/src/oidc/oidc.module.ts` | Bug 3: move `ensureTableExists` to `OnModuleInit` |
| `apps/api-gateway/src/oidc/adapters/pg-adapter.ts` | Bug 3: remove from constructor, expose as static init method |
| `apps/dgep/src/controllers/messaging.controller.ts` | Fix 9: add `x5c` to JWKS response |
| `apps/lotl/src/` | Fix 11: add ETSI TSL XML endpoint |
| Cron schedulers | Fix 12: fix negative timeout |

### eguilde (portal backend — live source)

| File | Change |
|------|--------|
| `backend/src/verifier/verifier.service.ts` | Bug 4: store DCQL in DB; Bug 5: fix `birth_date` in DCQL |
| `backend/src/verifier/trust.service.ts` | Fix 7: fail closed; Fix 10: x5c chain validation |
| `backend/src/verifier/verifier.service.ts` | Fix 6: normalize issuer URL in JWKS lookup |

### Android wallet (`eguilde_wallet/wallet/` — requires APK rebuild)

| Area | Change |
|------|--------|
| Credential request flow | Fix 8: hardware key generation in Android Keystore |
| Credential request | Fix 8: include key attestation with credential request |
| KB-JWT signing | Ensure hardware key is used for KB-JWT signing |

---

## Non-Goals (Documented Follow-ups)

- **EU-level LOTL consumption:** N/A — this IS the national LOTL
- **mTLS between services:** N/A — PostgreSQL messaging, not HTTP
- **Multi-key rotation:** Important but requires operational process, not code
- **Batch issuance:** Declared in metadata but not needed for current use case

---

## Testing Procedure

After all fixes are deployed:

1. `curl https://wallet.eguilde.cloud/.well-known/openid-credential-issuer` → HTTP 200 with valid JSON
2. `curl https://wallet.eguilde.cloud/.well-known/jwks.json` → HTTP 200 with keys including `x5c`
3. Android wallet: scan credential offer QR → enter PIN → PID issued ✓
4. Portal: click "Login with EUDI Wallet" → scan QR → confirm → logged in with LoA High ✓
5. Admin: revoke PID → repeat step 4 → login rejected with "Credential is REVOKED" ✓
6. Simulate LOTL down → login attempt → rejected with "Issuer trust cannot be verified" ✓
