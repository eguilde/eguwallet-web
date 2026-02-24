# Design: P1 eIDAS 2.0 Compliance Gaps

> Date: 2026-02-24
> Status: Approved
> Gaps addressed: PS-01/02/03 (pseudonyms), PI-03 (HAIP 1.0), PI-02 (OpenID4VP fixes), CR-04 (PQC roadmap)

---

## Gap 1 — Pseudonym System (`eguwallet-wallet-provider`)

### Approach
HMAC-derived, deterministic pseudonyms. No DB table — stateless derivation.

### Derivation
```
pseudonym = base64url(HMAC-SHA256(
  walletInstanceId + ':' + rpClientId,
  process.env.PSEUDONYM_SECRET   // 32-byte hex env var
))
```

Cross-RP unlinkability is guaranteed because the RP `client_id` is baked into the HMAC input. Revoking the wallet instance implicitly revokes all its pseudonyms.

### New Files
- `src/pseudonym/pseudonym.module.ts`
- `src/pseudonym/pseudonym.service.ts` — `getPseudonym(walletInstanceId, rpClientId): string`

### Integration Points
- `wallet.controller.ts` — message handler `get_pseudonym`
- `wallet-http.controller.ts` — `GET /api/wallet/pseudonym/:rpClientId`
- `openid4vp.service.ts` — when DCQL `credential_type = 'pseudonym'`, resolve via `PseudonymService`
- `wallet-attestation.service.ts` — add `pseudonym_support: true` to WUA JWT payload

### ENV
`PSEUDONYM_SECRET` — 32-byte hex, must be in docker-compose and .env files.

---

## Gap 2 — HAIP 1.0 Profile (full stack)

### Backend (`eguwallet-wallet-provider`)

1. **`well-known.controller.ts`** — add to issuer/authorization server metadata:
   ```json
   "profiles_supported": ["haip"],
   "response_modes_supported": ["direct_post", "direct_post.jwt"],
   "request_object_signing_alg_values_supported": ["ES256"]
   ```

2. **`openid4vp.service.ts:537`** — replace `jose.decodeJwt(requestJwt)` with `jose.jwtVerify(requestJwt, jwks)` where `jwks` is fetched from the verifier's `client_id` (x509 or `jwks_uri` from client metadata). Throw `UnauthorizedException` on failure.

3. **`openid4vp.service.ts:551-555`** — remove `presentation_definition` fallback entirely. If no `dcql_query` present, throw `400 Bad Request: dcql_query required (ARF 2.5.0)`.

4. **JARM support** — when `response_mode = direct_post.jwt`, wrap VP response in JWE using verifier's ephemeral key (`epk` from authorization request). New `JarmService` in `src/cryptography/services/jarm.service.ts`.

### Android (`eguwallet-android`)

1. **WUA payload** (via `wallet-attestation.service.ts` in wallet-provider) — add `haip_profile: '1.0'` claim.

2. **`CredentialPresentationManager.kt`** — default VP response mode to `direct_post.jwt`; encrypt `vp_token` response as JWE using verifier's `epk`.

---

## Gap 3 — OpenID4VP Fixes (bundled with HAIP)

Both fixes are in `eguwallet-wallet-provider/src/services/openid4vp.service.ts`:
- Line 537: `decodeJwt` → `jwtVerify` with verifier JWKS
- Lines 551-555: remove `presentation_definition` fallback, DCQL-only

These are delivered as part of the HAIP 1.0 implementation (Gap 2).

---

## Gap 4 — PQC Roadmap (documentation)

Create `docs/compliance/pqc-roadmap.md`:
- Current algorithm inventory
- NIST FIPS 203/204/205 timeline (finalized Aug 2024)
- ETSI/CEN 319-series PQC update schedule (2026-2027)
- EguWallet hybrid migration targets (classical + ML-KEM/ML-DSA by 2028)
- Affected components per algorithm