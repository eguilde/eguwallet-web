# eIDAS 2.0 Full Compliance Fixes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all eIDAS 2.0 compliance gaps across the eguwallet ecosystem and eguilde verifier (HSM excluded — considered done).

**Architecture:** 30 fixes across 7 repositories, grouped by repo for parallel execution. Each fix is self-contained. Repos: eguwallet-wallet-provider, eguwallet-dgep, eguwallet-dgp, eguwallet-qtsp, eguwallet-lotl, eguwallet-certification, eguilde.

**Tech Stack:** NestJS 10/11, TypeScript, PostgreSQL, jose, @peculiar/x509, pkijs, cbor, Angular 21

---

## Group A: eguwallet-dgp (12 fixes — most work needed)

### A1: Sign status list as JWT (CRITICAL)
**Files:** `apps/dgp/src/services/credential-status.service.ts`, `apps/dgp/src/services/issuer-key.service.ts`
- Import IssuerKeyService into CredentialStatusService
- In `getStatusList()`, wrap the status list credential in a signed JWT (ES256)
- Use `jose.SignJWT` with issuer key, `typ: 'statuslist+jwt'`
- Return signed JWT instead of raw JSON

### A2: Add status claim to issued credentials (CRITICAL)
**Files:** `apps/dgp/src/services/sd-jwt.service.ts`
- In `generatePidCredential()`, add `status` object to JWT payload:
  ```json
  "status": { "status_list": { "idx": <index>, "uri": "<issuerUrl>/credentials/status/1" } }
  ```
- Call `StatusListService` (or equivalent) to allocate index before issuance

### A3: Authenticate revocation endpoints (CRITICAL)
**Files:** `apps/dgp/src/controllers/status.controller.ts`
- Add API key guard to `POST /credentials/status/revoke` and `/unrevoke`
- Use `X-Internal-Service-Key` header check (same pattern as api.controller.ts)
- Keep GET endpoints public (relying parties need access)

### A4: Use pseudonymous subject (HIGH)
**Files:** `apps/dgp/src/services/sd-jwt.service.ts`
- Replace `sub: cnp` with `sub: HMAC-SHA256(cnp, issuerUrl)` encoded as `urn:uuid:<hex>`
- Import crypto, use `crypto.createHmac('sha256', issuerUrl).update(cnp).digest('hex')`

### A5: Add mdoc (mso_mdoc) format (MANDATORY)
**Files:** Create `apps/dgp/src/services/mdoc.service.ts`, modify `apps/dgp/src/services/credential-issuance.service.ts`, modify `apps/dgp/src/controllers/credential.controller.ts`
- Port `MdocService` from eguwallet-dgep (same CBOR structure)
- In credential endpoint, add `mso_mdoc` format handling
- Build IssuerSigned with nameSpaces, MSO with deviceKeyInfo
- Sign with COSE_Sign1 (ES256 = alg -7)
- Add `mso_mdoc` to well-known metadata `credential_configurations_supported`

### A6: Migrate to RFC 9427 Token Status List (HIGH)
**Files:** `apps/dgp/src/services/credential-status.service.ts`, `apps/dgp/src/services/status-list.service.ts` (create if needed)
- Replace W3C StatusList2021 format with RFC 9427 Token Status List
- Status list JWT: `{ iss, sub, iat, exp, status_list: { bits: 1, lst: <gzip+b64url> } }`
- Maintain same bitstring logic but change envelope format

### A7: Add Android Key Attestation (MEDIUM)
**Files:** Create `apps/dgp/src/services/android-key-attestation.service.ts`, modify `apps/dgp/src/services/credential-issuance.service.ts`
- Port AndroidKeyAttestationService from DGEP
- In credential endpoint, accept optional `key_attestation` in request body
- Verify X.509 chain, check key matches proof JWK

### A8: Add PoP JWT iat freshness check (HIGH)
**Files:** `apps/dgp/src/services/credential-issuance.service.ts`
- In `validateProofOfPossession()`, after nonce check, add:
  ```typescript
  const now = Math.floor(Date.now() / 1000);
  if (decoded.payload.iat && Math.abs(now - decoded.payload.iat) > 300) {
    throw new BadRequestException({ error: 'invalid_proof', error_description: 'Proof JWT iat is too old' });
  }
  ```

### A9: Add TX code rate limiting (HIGH)
**Files:** `apps/dgp/src/services/pre-authorization.service.ts` or `apps/dgp/src/services/token.service.ts`
- Track failed tx_code attempts per pre-auth code in DB or in-memory Map
- After 5 failed attempts, lock the pre-auth code (mark as `locked` in DB)
- Return `invalid_grant` with description "Too many failed attempts"

### A10: Add credential_offer_uri by-reference (HIGH)
**Files:** `apps/dgp/src/controllers/credential-offer.controller.ts` (create), modify `apps/dgp/src/services/pre-authorization.service.ts`
- Add `GET /credential-offers/:offerId` public endpoint
- Store credential offer JSON in `dgp_pre_authorizations` table (add `offer_json` column)
- Return offer JSON when wallet fetches by reference
- Update email to use `credential_offer_uri` instead of inline

### A11: Add HTTP deferred-credential endpoint (MEDIUM)
**Files:** Create `apps/dgp/src/controllers/deferred-credential.controller.ts`
- Add `POST /deferred-credential` HTTP endpoint
- Accept `transaction_id` in request body
- Return credential if ready, or 202 with retry-after if still processing

### A12: Add credential suspension support (MEDIUM)
**Files:** `apps/dgp/src/services/credential-status.service.ts`, modify DB migration
- Add separate status list for suspension (purpose: 'suspension')
- Add `POST /credentials/status/suspend` and `/unsuspend` endpoints (authenticated)
- Add `suspended`, `suspended_at`, `suspension_reason` columns to `dgp_issued_pids`

---

## Group B: eguwallet-dgep (8 fixes)

### B1: Resolve dual status list implementations (HIGH)
**Files:** `apps/dgep/src/services/credential-status.service.ts`, `apps/dgep/src/dgep.module.ts`
- Remove W3C StatusList2021 implementation
- Keep only `StatusListService` (RFC 9427 with JWT signing)
- Update module imports

### B2: Add PoP JWT iat freshness check (HIGH)
**Files:** `apps/dgep/src/services/credential-issuance.service.ts`
- Same fix as A8 — add iat check in `validateProofOfPossession()`

### B3: Add TX code rate limiting (HIGH)
**Files:** `apps/dgep/src/services/token.service.ts` or `apps/dgep/src/services/pre-authorization.service.ts`
- Same pattern as A9

### B4: Add HTTP deferred-credential endpoint (HIGH)
**Files:** `apps/dgep/src/controllers/deferred-credential.controller.ts` (create from messaging handler)
- Expose existing deferred logic as HTTP `POST /deferred-credential`
- Add `deferred_credential_endpoint` to well-known metadata

### B5: Add credential_offer_uri by-reference (HIGH)
**Files:** Create endpoint, modify pre-authorization service
- Same pattern as A10

### B6: Add credential suspension support (MEDIUM)
**Files:** Similar to A12
- Add suspension status list + endpoints

### B7: Add WUA verification before issuance (MANDATORY)
**Files:** `apps/dgep/src/services/credential-issuance.service.ts`
- Before issuing credential, require `wallet_attestation` in request
- Verify WUA JWT signature against wallet provider's JWKS
- Check WUA is not expired
- Check attestation level meets LoA High requirements

### B8: Add status list auto-refresh job (HIGH)
**Files:** `apps/dgep/src/services/status-list.service.ts`
- Add `@Cron('0 */6 * * *')` scheduled job to regenerate status list JWT
- Prevents stale JWTs when no revocations happen

---

## Group C: eguwallet-wallet-provider (6 fixes)

### C1: Fix KB-JWT signature — remove PLACEHOLDER (CRITICAL)
**Files:** `apps/wallet-provider/src/services/openid4vp.service.ts`
- Replace `base64UrlEncode('SIGNATURE_PLACEHOLDER')` with actual ES256 signature
- Sign KB-JWT with device's private key using `crypto.sign('sha256', ...)`
- Use the wallet's WSCD key pair for signing

### C2: Add public attestation verification endpoint (HIGH)
**Files:** `apps/wallet-provider/src/controllers/wallet-http.controller.ts`
- Add `POST /api/attestation/verify` endpoint
- Accept attestation JWT in request body
- Verify signature using wallet provider's public key (from JWKS)
- Return verification result with attestation level and expiry

### C3: Encrypt proximity mdoc responses (HIGH)
**Files:** `apps/wallet-provider/src/services/proximity.service.ts`
- After creating DeviceResponse, encrypt using ECDHE session key
- Derive encryption key: `HKDF-SHA-256(ECDH_shared_secret, session_salt, 'SKReader')`
- Use AES-256-GCM for encryption
- Replace hardcoded `'SessionMACKey'` salt with session-derived value

### C4: Fix DPoP ath verification (MEDIUM)
**Files:** `apps/wallet-provider/src/services/dpop.service.ts`
- In DPoP proof verification, when `ath` is present:
  ```typescript
  const expectedAth = crypto.createHash('sha256').update(accessToken).digest('base64url');
  if (payload.ath !== expectedAth) throw new UnauthorizedException('DPoP ath mismatch');
  ```

### C5: Remove pre-authorized_code from OAuth metadata if not implemented (MEDIUM)
**Files:** `apps/wallet-provider/src/controllers/well-known.controller.ts`
- Remove `urn:ietf:params:oauth:grant-type:pre-authorized_code` from `grant_types_supported` if not implemented
- Or implement the grant type properly

### C6: Add notification endpoint (MEDIUM)
**Files:** Create `apps/wallet-provider/src/controllers/notification-http.controller.ts`
- Add `POST /notification` HTTP endpoint (expose existing messaging logic)
- Accept `notification_id`, `event`, `event_description`
- Add `notification_endpoint` to well-known metadata

---

## Group D: eguwallet-qtsp (6 fixes)

### D1: Fail hard on CA init failure (CRITICAL)
**Files:** `apps/qtsp/src/services/rfc6960-ocsp.service.ts`, `apps/qtsp/src/services/rfc5280-crl.service.ts`, `apps/qtsp/src/services/rfc3161-tsa.service.ts`
- In all three services, change `initializeXxxSigning()`:
  - If CA not found, throw `Error('CA not initialized — cannot serve unsigned responses')`
  - Remove `return;` after warning
  - Add retry logic (3 attempts, 10s delay)

### D2: Add CRL mandatory extensions (CRITICAL)
**Files:** `apps/qtsp/src/services/rfc5280-crl.service.ts`
- Add CRL Number extension (OID 2.5.29.20) — monotonically incrementing integer
- Add Authority Key Identifier (OID 2.5.29.35) — from issuing CA's subject key identifier
- Add Issuing Distribution Point (OID 2.5.29.28) — CRL URL
- Use `pkijs` to construct proper ASN.1 extensions

### D3: Add OCSP nonce support (HIGH)
**Files:** `apps/qtsp/src/services/rfc6960-ocsp.service.ts`
- Extract nonce from `tbsRequest.requestExtensions` (OID 1.3.6.1.5.5.7.48.1.2)
- Echo nonce in response's `responseExtensions`
- Use `pkijs` Nonce handling

### D4: Fix OCSP GET endpoint to return DER (HIGH)
**Files:** `apps/qtsp/src/controllers/rfc-endpoints.controller.ts`
- Change `GET /ocsp/:serialNumber` to return DER-encoded OCSPResponse
- Set `Content-Type: application/ocsp-response`
- Build proper BasicOCSPResponse for single cert

### D5: Change TSA policy OID (MEDIUM)
**Files:** `apps/qtsp/src/services/rfc3161-tsa.service.ts`
- Replace Google's OID `1.3.6.1.4.1.11129.2.4.2` with eguwallet-specific:
  `1.3.6.1.4.1.XXXXX.1.1` (use a placeholder private enterprise number)

### D6: Add rate limiting on public endpoints (MEDIUM)
**Files:** `apps/qtsp/src/main.ts` or create rate-limit middleware
- Add NestJS `@nestjs/throttler` or custom middleware
- OCSP: 100 req/min per IP
- CRL: 10 req/min per IP
- TSA: 50 req/min per IP

---

## Group E: eguwallet-lotl (3 fixes)

### E1: Sign TSL with QTSP scheme operator cert (HIGH)
**Files:** `apps/lotl/src/services/xml-signature.service.ts`
- Replace self-signed RSA key with certificate obtained from QTSP
- Call QtspClientService to get signing certificate
- Use QTSP-issued cert for XMLDSig

### E2: Reject services with invalid XML signatures during EU sync (HIGH)
**Files:** `apps/lotl/src/services/eu-synchronization.service.ts`
- Change signature failure handling from `continue` to `reject`
- If `signature_verified=false`, do NOT import services
- Log as compliance violation

### E3: Expose public REST endpoint for issuer verification (HIGH)
**Files:** Create or modify `apps/lotl/src/controllers/public.controller.ts`
- Add `GET /api/verify-issuer?issuerUrl=<url>` public REST endpoint
- Reuse `trustedServiceService.verifyIssuerByUrl()` logic
- No authentication required (relying parties need access)

---

## Group F: eguwallet-certification (3 fixes)

### F1: Persist signing key to database (CRITICAL)
**Files:** `apps/certification/src/services/certification.service.ts`, DB migration
- On startup, check DB for existing key pair
- If none, generate new EC P-256 key and store in `cert_signing_keys` table
- Load from DB on subsequent startups
- Key columns: `private_key_pem`, `public_key_pem`, `public_jwk`, `created_at`

### F2: Expose JWKS endpoint via HTTP (CRITICAL)
**Files:** `apps/certification/src/controllers/api.controller.ts`
- Add `GET /.well-known/jwks.json` public endpoint
- Return `{ keys: [{ kty, crv, x, y, kid, use: 'sig', alg: 'ES256' }] }`
- No authentication required

### F3: Auto-push certifications to LOTL (HIGH)
**Files:** `apps/certification/src/services/lotl-sync.service.ts`
- After successful certification decision, call LOTL service to register provider
- Use HTTP endpoint: `POST /api/internal/lotl/register-service`
- Map entity type to LOTL service type (WALLET_PROVIDER, PID_PROVIDER, etc.)

---

## Group G: eguilde verifier (5 fixes)

### G1: Add mdoc COSE_Sign1 signature verification (CRITICAL)
**Files:** `backend/src/verifier/verifier.service.ts`, `backend/src/verifier/trust.service.ts`
- In `extractClaimsFromMdoc()`, after CBOR decode:
  - Extract issuerAuth (COSE_Sign1) from document
  - Fetch issuer's public key from JWKS
  - Verify COSE_Sign1 signature
  - Validate MSO (Mobile Security Object) digest chain

### G2: Add Wallet Unit Attestation verification (MANDATORY)
**Files:** `backend/src/verifier/verifier.service.ts`
- In `handleWalletResponse()`, require `wallet_attestation` in submission
- Verify WUA JWT signature against wallet provider's JWKS
- Check WUA expiry and attestation level
- Reject if WUA missing or invalid

### G3: Add verifier metadata publication (HIGH)
**Files:** `backend/src/verifier/verifier.controller.ts`
- Add `GET /verifier/.well-known/openid4vp-authorization-server` endpoint
- Return metadata: `{ issuer, presentation_definition_uri_supported, vp_formats_supported, client_id_schemes_supported }`

### G4: Add proximity verification (ISO 18013-5) (MANDATORY — STUB)
**Files:** Create `backend/src/verifier/proximity-verifier.service.ts`, `backend/src/verifier/proximity-verifier.controller.ts`
- Implement QR code generation for device engagement
- Implement session data request/response flow
- Implement DeviceResponse verification (COSE_Sign1 + MAC)
- Endpoints: `/verifier/proximity/engagement`, `/verifier/proximity/session/:id/verify`

### G5: Add RP registration enforcement (HIGH)
**Files:** `backend/src/verifier/rp-bootstrap.service.ts`
- Make RP bootstrap mandatory (not optional based on env var)
- On first startup, register with LOTL
- Store RP access certificate
- Reject verification requests if not registered

---

## Execution Strategy

Groups A-G are independent repositories and can be executed in parallel.
Within each group, tasks are ordered by dependency (critical first).
Each task should be committed separately.
