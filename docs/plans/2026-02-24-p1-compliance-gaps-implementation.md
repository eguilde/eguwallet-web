# P1 eIDAS 2.0 Compliance Gaps — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 4 P1 eIDAS 2.0 compliance gaps: pseudonym system (PS-01/02/03), HAIP 1.0 profile (PI-03), OpenID4VP security fixes (PI-02), and PQC roadmap doc (CR-04).

**Architecture:**
- `eguwallet-wallet-provider` (NestJS at `C:/dev/eguwallet-wallet-provider/`) — all TypeScript/NestJS changes
- `eguwallet-android` (Kotlin at `C:/dev/eguwallet-android/`) — Android client HAIP changes
- `docs/compliance/` — PQC roadmap documentation

**Tech Stack:** NestJS, Jest, `jose` (JWT/JWE), Node.js `crypto`, Kotlin, Android Keystore API

---

## Task 1: PseudonymService — stateless HMAC derivation

**Files:**
- Create: `C:/dev/eguwallet-wallet-provider/src/pseudonym/pseudonym.service.ts`
- Create: `C:/dev/eguwallet-wallet-provider/src/pseudonym/pseudonym.service.spec.ts`

**Step 1: Write the failing test**

Create `C:/dev/eguwallet-wallet-provider/src/pseudonym/pseudonym.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { PseudonymService } from './pseudonym.service';

describe('PseudonymService', () => {
  let service: PseudonymService;

  const mockConfigService = {
    get: jest.fn().mockImplementation((key: string) => {
      if (key === 'PSEUDONYM_SECRET') return 'a'.repeat(64); // 32-byte hex
      return undefined;
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PseudonymService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<PseudonymService>(PseudonymService);
  });

  it('returns a base64url string for a given wallet+RP pair', () => {
    const result = service.getPseudonym('wallet-123', 'rp-client-abc');
    expect(typeof result).toBe('string');
    expect(result).toMatch(/^[A-Za-z0-9_-]+$/); // base64url charset
    expect(result.length).toBeGreaterThan(20);
  });

  it('is deterministic — same inputs always produce same pseudonym', () => {
    const a = service.getPseudonym('wallet-123', 'rp-client-abc');
    const b = service.getPseudonym('wallet-123', 'rp-client-abc');
    expect(a).toBe(b);
  });

  it('produces different pseudonyms for different RPs (cross-RP unlinkability)', () => {
    const p1 = service.getPseudonym('wallet-123', 'rp-client-abc');
    const p2 = service.getPseudonym('wallet-123', 'rp-client-xyz');
    expect(p1).not.toBe(p2);
  });

  it('produces different pseudonyms for different wallet instances', () => {
    const p1 = service.getPseudonym('wallet-111', 'rp-client-abc');
    const p2 = service.getPseudonym('wallet-222', 'rp-client-abc');
    expect(p1).not.toBe(p2);
  });

  it('throws if PSEUDONYM_SECRET is not configured', () => {
    mockConfigService.get.mockReturnValue(undefined);
    expect(() => service.getPseudonym('wallet-123', 'rp-client-abc'))
      .toThrow('PSEUDONYM_SECRET');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern pseudonym.service.spec --no-coverage
```

Expected: FAIL — `Cannot find module './pseudonym.service'`

**Step 3: Implement PseudonymService**

Create `C:/dev/eguwallet-wallet-provider/src/pseudonym/pseudonym.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Pseudonym Service
 *
 * eIDAS 2.0 ARF — Article 5a(4)(d) + ARF HLR WP.40
 * Provides wallet-unit-specific, relying-party-specific pseudonyms.
 *
 * Derivation: HMAC-SHA256(walletInstanceId + ':' + rpClientId, PSEUDONYM_SECRET)
 * - Deterministic: same inputs → same pseudonym (no storage needed)
 * - RP-specific: different pseudonym per RP → cross-RP tracking impossible
 * - Wallet-specific: different pseudonym per wallet instance
 */
@Injectable()
export class PseudonymService {
  private readonly logger = new Logger(PseudonymService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Derive a pseudonym for a wallet instance + relying party pair.
   *
   * @param walletInstanceId - The unique ID of the wallet unit
   * @param rpClientId - The client_id of the relying party
   * @returns base64url-encoded pseudonym string
   */
  getPseudonym(walletInstanceId: string, rpClientId: string): string {
    const secret = this.configService.get<string>('PSEUDONYM_SECRET');
    if (!secret) {
      throw new Error('PSEUDONYM_SECRET environment variable is not configured');
    }

    const secretBytes = Buffer.from(secret, 'hex');
    const input = `${walletInstanceId}:${rpClientId}`;
    const hmac = crypto.createHmac('sha256', secretBytes);
    hmac.update(input, 'utf8');
    const digest = hmac.digest();

    // base64url encoding (no padding, URL-safe)
    return digest.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
```

**Step 4: Run tests to verify they pass**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern pseudonym.service.spec --no-coverage
```

Expected: PASS — 5 tests passing

**Step 5: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/pseudonym/pseudonym.service.ts src/pseudonym/pseudonym.service.spec.ts
git commit -m "feat(pseudonym): add PseudonymService with HMAC-SHA256 derivation (PS-01)

eIDAS 2.0 ARF Article 5a(4)(d) — wallet-unit-specific, RP-specific
pseudonyms. Deterministic HMAC derivation — no DB storage required.
Cross-RP unlinkability guaranteed by RP client_id in HMAC input."
```

---

## Task 2: Register PseudonymService in AppModule

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/app.module.ts`

**Step 1: Add import and provider**

In `src/app.module.ts`, add the import at the top:
```typescript
import { PseudonymService } from './pseudonym/pseudonym.service';
```

Add `PseudonymService` to both `providers` and `exports` arrays (follow the same pattern as the existing services in the file).

**Step 2: Verify the app still compiles**

```bash
cd C:/dev/eguwallet-wallet-provider
npm run build 2>&1 | tail -5
```

Expected: No TypeScript errors, build succeeds.

**Step 3: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/app.module.ts
git commit -m "feat(pseudonym): register PseudonymService in AppModule"
```

---

## Task 3: Pseudonym HTTP endpoint

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/controllers/wallet-http.controller.ts`

**Step 1: Read the file to understand the pattern**

Read `C:/dev/eguwallet-wallet-provider/src/controllers/wallet-http.controller.ts` and note how existing `@Get` endpoints work and how the `WalletService` is injected.

**Step 2: Add the endpoint**

In `WalletHttpController`, inject `PseudonymService`:

```typescript
// Add to constructor parameters:
private readonly pseudonymService: PseudonymService,
```

Add the endpoint (inside the `WalletHttpController` class, following the existing pattern):

```typescript
/**
 * Get pseudonym for a specific relying party
 * eIDAS 2.0 ARF — PS-01/PS-02/PS-03
 */
@Get('pseudonym/:rpClientId')
@UseGuards(/* same auth guard used on other endpoints in this controller */)
async getPseudonym(
  @Param('rpClientId') rpClientId: string,
  @Req() req: any,
): Promise<{ pseudonym: string; rpClientId: string }> {
  const walletInstanceId = req.walletInstanceId; // extracted by auth guard
  const pseudonym = this.pseudonymService.getPseudonym(walletInstanceId, rpClientId);
  return { pseudonym, rpClientId };
}
```

> **Note:** Check how `walletInstanceId` is extracted from the request in other endpoints — use the same pattern.

**Step 3: Verify build**

```bash
cd C:/dev/eguwallet-wallet-provider
npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/controllers/wallet-http.controller.ts
git commit -m "feat(pseudonym): add GET /api/wallet/pseudonym/:rpClientId endpoint (PS-03)"
```

---

## Task 4: Add pseudonym_support and haip_profile to WUA payload

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/services/wallet-attestation.service.ts`

**Step 1: Locate the attestation payload**

Open `src/services/wallet-attestation.service.ts` and find `attestationPayload` (lines 203–240). The object ends with `wallet_provider_certification: { ... }`.

**Step 2: Add the two new claims**

After `wallet_provider_certification`, add:

```typescript
        // PS-01/02/03: Pseudonym support declaration (eIDAS ARF WP.40)
        pseudonym_support: true,

        // PI-03: HAIP 1.0 profile support declaration
        haip_profile: '1.0',
```

**Step 3: Run existing wallet-attestation tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern wallet-attestation.service.spec --no-coverage
```

Expected: All tests still pass (the test mocks `signJWT` so payload changes are invisible to existing tests).

**Step 4: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/services/wallet-attestation.service.ts
git commit -m "feat(wua): add pseudonym_support and haip_profile claims to WUA JWT

eIDAS 2.0 ARF — declares PS-01 and PI-03 compliance in WUA payload
so PID issuers and verifiers can determine wallet capabilities."
```

---

## Task 5: OpenID4VP — enforce DCQL-only (remove presentation_definition fallback)

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/services/openid4vp.service.ts`

**Step 1: Find the fallback code**

In `openid4vp.service.ts` around lines 551–555, you'll find:

```typescript
const presentationDefinition = !dcqlQuery && params.presentation_definition
  ? typeof params.presentation_definition === 'string'
    ? JSON.parse(params.presentation_definition)
    : params.presentation_definition
  : undefined;
```

**Step 2: Write a test first**

Add to a new test file `src/services/openid4vp.service.spec.ts` (or add to existing if it exists):

```typescript
it('throws BadRequestException when presentation_definition is used instead of dcql_query', async () => {
  await expect(
    service.parseAuthorizationRequest({
      client_id: 'https://verifier.example.com',
      response_type: 'vp_token',
      nonce: 'test-nonce',
      presentation_definition: { id: 'legacy', input_descriptors: [] },
      // no dcql_query
    })
  ).rejects.toThrow('dcql_query is required');
});
```

Run to verify FAIL:
```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern openid4vp --no-coverage 2>&1 | tail -20
```

**Step 3: Remove the fallback and add enforcement**

Replace the `presentationDefinition` block (lines ~551-555) with:

```typescript
// ARF 2.5.0: DCQL-only. presentation_definition is removed from the spec.
if (!dcqlQuery && params.presentation_definition) {
  throw new BadRequestException(
    'dcql_query is required. presentation_definition is not supported (ARF 2.5.0 — DCQL only).'
  );
}
```

Also remove any downstream references to `presentationDefinition` in the returned object. Search for `presentationDefinition` in `openid4vp.service.ts` and remove all usages (the variable no longer exists).

**Step 4: Run tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern openid4vp --no-coverage
```

Expected: PASS (including the new test)

**Step 5: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/services/openid4vp.service.ts
git commit -m "fix(openid4vp): enforce DCQL-only — reject presentation_definition (ARF 2.5.0)

PI-02/PI-04: ARF 2.5.0 mandates dcql_query. presentation_definition
support removed. Throw 400 if caller attempts to use it."
```

---

## Task 6: OpenID4VP — verify JWT request object signature

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/services/openid4vp.service.ts`

**Step 1: Find the vulnerable code**

In `openid4vp.service.ts` around line 535–539, you'll find `decodeRequestJwt`:

```typescript
private async decodeRequestJwt(requestJwt: string): Promise<AuthorizationRequest> {
  // Decode without verification (verification happens at client metadata level)
  const payload = jose.decodeJwt(requestJwt);
  return payload as any;
}
```

**Step 2: Write a failing test**

```typescript
it('rejects a request JWT with an invalid signature', async () => {
  // A JWT with a tampered signature
  const tamperedJwt = 'eyJhbGciOiJFUzI1NiJ9.eyJjbGllbnRfaWQiOiJodHRwczovL2V2aWwuY29tIn0.invalidsignature';
  await expect(
    service['decodeRequestJwt'](tamperedJwt, 'https://verifier.example.com/.well-known/jwks.json')
  ).rejects.toThrow();
});
```

Run to verify FAIL:
```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern openid4vp --no-coverage 2>&1 | tail -20
```

**Step 3: Replace decodeRequestJwt with signature verification**

```typescript
private async decodeRequestJwt(requestJwt: string, jwksUri: string): Promise<AuthorizationRequest> {
  // HAIP 1.0 / ARF security: verify the request JWT signature against the verifier's JWKS
  // The jwksUri is taken from the client_id or client_metadata.jwks_uri
  if (!jwksUri) {
    throw new BadRequestException('Cannot verify request JWT: no jwks_uri available for client');
  }

  const jwks = jose.createRemoteJWKSet(new URL(jwksUri));

  try {
    const { payload } = await jose.jwtVerify(requestJwt, jwks, {
      algorithms: ['ES256', 'ES384', 'ES512'],
    });
    return payload as any;
  } catch (err) {
    throw new BadRequestException(`Request JWT signature verification failed: ${err.message}`);
  }
}
```

**Step 4: Update the caller of decodeRequestJwt**

Find where `decodeRequestJwt` is called (inside `fetchRequestUri` or similar). Update it to pass the `jwks_uri` from the client metadata:

```typescript
// Before calling decodeRequestJwt, extract jwks_uri from the decoded header or client_id endpoint
const header = jose.decodeProtectedHeader(requestJwt);
// client_id should be a URL for x509 or JWKS resolution
const clientId = params.client_id;
const jwksUri = `${clientId}/.well-known/jwks.json`; // HAIP: client_id is verifier base URL
return await this.decodeRequestJwt(response.data, jwksUri);
```

**Step 5: Run tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern openid4vp --no-coverage
```

**Step 6: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/services/openid4vp.service.ts
git commit -m "fix(openid4vp): verify JWT request object signature with verifier JWKS (HAIP 1.0)

Security fix: decodeJwt (no-verify) → jwtVerify with verifier JWKS.
Prevents accepting forged authorization requests."
```

---

## Task 7: JARM service — JWE encryption for direct_post.jwt

**Files:**
- Create: `C:/dev/eguwallet-wallet-provider/src/cryptography/services/jarm.service.ts`
- Create: `C:/dev/eguwallet-wallet-provider/src/cryptography/services/jarm.service.spec.ts`

**Step 1: Write the failing test**

Create `src/cryptography/services/jarm.service.spec.ts`:

```typescript
import { JarmService } from './jarm.service';
import * as jose from 'jose';

describe('JarmService', () => {
  let service: JarmService;

  beforeEach(() => {
    service = new JarmService();
  });

  it('wraps a VP token in a JWE using the provided epk', async () => {
    // Generate a real ephemeral key pair for testing
    const { publicKey, privateKey } = await jose.generateKeyPair('ECDH-ES', { crv: 'P-256' });
    const epk = await jose.exportJWK(publicKey);

    const vpToken = 'eyJhbGciOiJFUzI1NiJ9.test.token';
    const state = 'test-state-123';

    const jwe = await service.encryptResponse({ vp_token: vpToken, state }, epk);

    // Must be a valid compact JWE (5 dot-separated parts)
    const parts = jwe.split('.');
    expect(parts).toHaveLength(5);

    // Decrypt and verify contents
    const { plaintext } = await jose.compactDecrypt(jwe, privateKey);
    const decrypted = JSON.parse(new TextDecoder().decode(plaintext));
    expect(decrypted.vp_token).toBe(vpToken);
    expect(decrypted.state).toBe(state);
  });

  it('throws if epk is missing', async () => {
    await expect(
      service.encryptResponse({ vp_token: 'token', state: 'state' }, undefined as any)
    ).rejects.toThrow('epk');
  });
});
```

Run to verify FAIL:
```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern jarm.service.spec --no-coverage
```

**Step 2: Implement JarmService**

Create `src/cryptography/services/jarm.service.ts`:

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import * as jose from 'jose';

/**
 * JARM Service — JWT Secured Authorization Response Mode
 *
 * HAIP 1.0 / OpenID4VP 1.0: When response_mode = "direct_post.jwt",
 * the VP response must be encrypted as a JWE using the verifier's
 * ephemeral public key (epk) from the authorization request.
 *
 * Algorithm: ECDH-ES (key agreement) + A256GCM (content encryption)
 */
@Injectable()
export class JarmService {
  /**
   * Encrypt a VP response object as a compact JWE.
   *
   * @param response - Object containing vp_token (and optionally state)
   * @param epk - Verifier's ephemeral public key JWK from the authorization request
   * @returns Compact JWE string (5 dot-separated parts)
   */
  async encryptResponse(
    response: { vp_token: string; state?: string },
    epk: jose.JWK,
  ): Promise<string> {
    if (!epk) {
      throw new BadRequestException('epk is required for direct_post.jwt response mode');
    }

    const verifierPublicKey = await jose.importJWK(epk, 'ECDH-ES');
    const plaintext = new TextEncoder().encode(JSON.stringify(response));

    const jwe = await new jose.CompactEncrypt(plaintext)
      .setProtectedHeader({
        alg: 'ECDH-ES',
        enc: 'A256GCM',
        typ: 'JWT',
      })
      .encrypt(verifierPublicKey);

    return jwe;
  }
}
```

**Step 3: Run tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern jarm.service.spec --no-coverage
```

Expected: PASS

**Step 4: Register JarmService in app.module.ts**

In `src/app.module.ts`, add:
```typescript
import { JarmService } from './cryptography/services/jarm.service';
```
Add `JarmService` to `providers` and `exports`.

**Step 5: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/cryptography/services/jarm.service.ts src/cryptography/services/jarm.service.spec.ts src/app.module.ts
git commit -m "feat(haip): add JarmService for JWE-encrypted direct_post.jwt responses

HAIP 1.0: when response_mode=direct_post.jwt, VP responses are
encrypted with verifier's ephemeral key (ECDH-ES+A256GCM)."
```

---

## Task 8: OpenID4VP — integrate JARM for direct_post.jwt response mode

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/services/openid4vp.service.ts`

**Step 1: Inject JarmService**

In the constructor of `OpenId4VpService`, add:
```typescript
private readonly jarmService: JarmService,
```
Import `JarmService` at the top.

**Step 2: Find submitVpToken or the VP response sending logic**

Read `openid4vp.service.ts` and find where the `vp_token` is sent back to the verifier via `direct_post` (look for `axios.post` with `vp_token`).

**Step 3: Add the JARM branch**

Locate the response submission section. Replace the plain `direct_post` post with:

```typescript
const responsePayload = { vp_token: vpToken, state: authRequest.state };

let postedBody: any;
if (authRequest.response_mode === 'direct_post.jwt') {
  if (!authRequest.client_metadata?.authorization_encrypted_response_enc) {
    throw new BadRequestException('direct_post.jwt requires epk in authorization request');
  }
  const epk = authRequest.client_metadata?.jwks?.keys?.[0]; // verifier's ephemeral key
  const jwe = await this.jarmService.encryptResponse(responsePayload, epk);
  postedBody = { response: jwe };
} else {
  // Standard direct_post
  postedBody = responsePayload;
}

await axios.post(authRequest.redirect_uri, postedBody, {
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
});
```

**Step 4: Run all openid4vp tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern openid4vp --no-coverage
```

**Step 5: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/services/openid4vp.service.ts
git commit -m "feat(haip): use JarmService for direct_post.jwt response mode in OpenID4VP

HAIP 1.0: VP responses are JWE-encrypted when response_mode=direct_post.jwt."
```

---

## Task 9: HAIP metadata declaration in well-known endpoints

**Files:**
- Modify: `C:/dev/eguwallet-wallet-provider/src/controllers/well-known.controller.ts`

**Step 1: Update getAuthorizationServerMetadata**

In `getAuthorizationServerMetadata()` (line ~186), update `response_modes_supported`:

Find:
```typescript
response_modes_supported: [
  'query',
  'fragment',
],
```

Replace with:
```typescript
response_modes_supported: [
  'query',
  'fragment',
  'direct_post',
  'direct_post.jwt',   // HAIP 1.0
],

// HAIP 1.0 profile declaration
profiles_supported: ['haip'],

// HAIP: signed request objects
request_object_signing_alg_values_supported: ['ES256'],
```

**Step 2: Update getCredentialIssuerMetadata**

In `getCredentialIssuerMetadata()` (line ~34), after the `signed_metadata` field, add:

```typescript
// HAIP 1.0 profile compliance
profiles_supported: ['haip'],
response_modes_supported: ['direct_post', 'direct_post.jwt'],
```

**Step 3: Run discovery controller tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test -- --testPathPattern well-known --no-coverage
```

If no tests exist for well-known, check `discovery.controller.spec.ts` and verify it still passes.

**Step 4: Commit**

```bash
cd C:/dev/eguwallet-wallet-provider
git add src/controllers/well-known.controller.ts
git commit -m "feat(haip): declare HAIP 1.0 profile in .well-known metadata (PI-03)

HAIP 1.0: add profiles_supported, direct_post.jwt response mode,
and request_object_signing_alg_values_supported to both
openid-credential-issuer and oauth-authorization-server metadata."
```

---

## Task 10: Run full test suite for wallet-provider

**Step 1: Run all tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test --no-coverage 2>&1 | tail -30
```

Expected: All tests pass. Fix any regressions before continuing.

**Step 2: Commit if any fixes were needed**

```bash
cd C:/dev/eguwallet-wallet-provider
git add -p
git commit -m "fix: resolve test regressions from HAIP and pseudonym changes"
```

---

## Task 11: Android — default to direct_post.jwt response mode

**Files:**
- Modify: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/domain/proximity/ProximityPresentationManager.kt` (check path — may be in presentation manager not proximity)
- Modify: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/security/CredentialPresentationManager.kt`

**Step 1: Read the file**

Read `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/security/CredentialPresentationManager.kt` to understand the VP response flow.

**Step 2: Find where response_mode is set or consumed**

Search for `direct_post`, `response_mode`, or `vp_token` in `CredentialPresentationManager.kt`.

**Step 3: Add JARM encryption for direct_post.jwt**

When the authorization request has `response_mode = "direct_post.jwt"`, the Android app must:
1. Extract the verifier's `epk` (ephemeral public key) from the authorization request `client_metadata.jwks.keys[0]`
2. Encrypt the VP response as a JWE using ECDH-ES + A256GCM
3. Post `{ response: <jwe_string> }` instead of plain `{ vp_token: ..., state: ... }`

Add a `JarmEncryptor` helper in `com.eguwallet.wallet.security`:

```kotlin
package com.eguwallet.wallet.security

import com.nimbusds.jose.*
import com.nimbusds.jose.crypto.ECDHEncrypter
import com.nimbusds.jose.jwk.ECKey
import org.json.JSONObject

object JarmEncryptor {
    /**
     * Encrypt VP response as JWE for direct_post.jwt response mode.
     * HAIP 1.0: ECDH-ES key agreement + A256GCM content encryption.
     */
    fun encrypt(vpToken: String, state: String?, epkJson: String): String {
        val epk = ECKey.parse(epkJson)
        val payload = JSONObject().apply {
            put("vp_token", vpToken)
            state?.let { put("state", it) }
        }.toString()

        val header = JWEHeader.Builder(JWEAlgorithm.ECDH_ES, EncryptionMethod.A256GCM)
            .type(JOSEObjectType("JWT"))
            .build()

        val jwe = JWEObject(header, Payload(payload))
        jwe.encrypt(ECDHEncrypter(epk))
        return jwe.serialize()
    }
}
```

In `CredentialPresentationManager.kt`, before posting the response:

```kotlin
val responseBody = if (responseMode == "direct_post.jwt") {
    val epkJson = authRequest.clientMetadata?.jwks?.keys?.firstOrNull()?.toString()
        ?: throw IllegalStateException("direct_post.jwt requires epk in client_metadata")
    val jwe = JarmEncryptor.encrypt(vpToken, state, epkJson)
    mapOf("response" to jwe)
} else {
    mapOf("vp_token" to vpToken, "state" to state).filterValues { it != null }
}
```

> **Dependency note:** `nimbus-jose-jwt` is already a standard Android security library. Check `app/build.gradle` — if not present, add:
> ```gradle
> implementation 'com.nimbusds:nimbus-jose-jwt:9.37.3'
> ```

**Step 4: Build the Android project to verify**

```bash
cd C:/dev/eguwallet-android
./gradlew assembleDebug 2>&1 | tail -20
```

Expected: BUILD SUCCESSFUL

**Step 5: Commit**

```bash
cd C:/dev/eguwallet-android
git add app/src/main/java/com/eguwallet/wallet/security/JarmEncryptor.kt
git add app/src/main/java/com/eguwallet/wallet/security/CredentialPresentationManager.kt
git add app/build.gradle
git commit -m "feat(haip): implement JARM JWE encryption for direct_post.jwt response mode

HAIP 1.0: when verifier requests direct_post.jwt, the Android wallet
now encrypts the VP response as JWE (ECDH-ES + A256GCM) using the
verifier's ephemeral public key."
```

---

## Task 12: PQC Roadmap documentation

**Files:**
- Create: `C:/dev/eguilde/docs/compliance/pqc-roadmap.md`

**Step 1: Create the document**

Create `C:/dev/eguilde/docs/compliance/pqc-roadmap.md`:

```markdown
# Post-Quantum Cryptography Roadmap — EguWallet

> Last updated: 2026-02-24
> Status: Planning phase
> Target: Hybrid PQC mode by 2028 (migration window before EU mandate ~2029)

---

## Current Algorithm Inventory

| Component | Algorithm | Key Size | Usage |
|---|---|---|---|
| WUA signing | ES256 (ECDSA P-256) | 256-bit | Wallet attestation JWT |
| RP key pair | ES256 (ECDSA P-256) | 256-bit | Authorization requests |
| SD-JWT signing | ES256 (ECDSA P-256) | 256-bit | PID credential signing |
| KB-JWT | ES256 (ECDSA P-256) | 256-bit | Holder binding |
| JARM | ECDH-ES + A256GCM | 256-bit | VP response encryption |
| Backup | AES-256-GCM + PBKDF2 | 256-bit | Wallet backup encryption |
| Trust chain | RS256 (RSA-2048) | 2048-bit | Fallback issuer verification |
| Status list | GZIP + base64url | — | RFC 9427 Token Status List |

All current algorithms comply with ENISA / SOG-IS 2025 recommendations.
No SHA-1, no RSA <2048, no legacy curves (P-192, brainpool).

---

## Standards Timeline

| Standard | Status | Relevance |
|---|---|---|
| NIST FIPS 203 (ML-KEM / Kyber) | **Final** (Aug 2024) | Key encapsulation — replaces ECDH-ES |
| NIST FIPS 204 (ML-DSA / Dilithium) | **Final** (Aug 2024) | Digital signatures — replaces ECDSA |
| NIST FIPS 205 (SLH-DSA / SPHINCS+) | **Final** (Aug 2024) | Hash-based signatures — backup option |
| ETSI/CEN 319-series PQC updates | In progress (2025–2027) | Will update eIDAS trust service standards |
| ENISA PQC migration guidance | Published 2024 | Target: organizations complete PQC migration by 2030 |
| SOG-IS PQC algorithm update | Expected 2026–2027 | Will mandate PQC-capable algorithms |

---

## Migration Strategy

### Phase 1 — Inventory and Readiness (2026)
- [ ] Audit all cryptographic dependencies for PQC-readiness
- [ ] Evaluate `jose` (JavaScript) and `nimbus-jose-jwt` (Android) PQC support
- [ ] Identify WSCD/WSCA hardware PQC capability (StrongBox TEE roadmap)
- [ ] Monitor ETSI/CEN 319-series PQC draft publication

### Phase 2 — Hybrid Mode Implementation (2027)
- [ ] Implement hybrid signatures: ES256 + ML-DSA (Dilithium3) in parallel
- [ ] Hybrid key encapsulation: ECDH-ES + ML-KEM-768 for JARM
- [ ] Update WUA JWT to include hybrid signature
- [ ] Update `.well-known` metadata to advertise PQC-capable algorithms

### Phase 3 — Full PQC Migration (2028)
- [ ] Switch primary signing to ML-DSA (keep ES256 as backward-compat fallback)
- [ ] Remove RSA-2048 fallback (if no longer required by ETSI/CEN)
- [ ] Update all credential formats to PQC-primary
- [ ] PQC certification: engage ITSEF for re-evaluation of cryptographic modules

---

## Affected Components by Algorithm

| New Algorithm | Replaces | Affected Components |
|---|---|---|
| ML-DSA (Dilithium3) | ES256 (ECDSA P-256) | WUA signing, RP key pair, SD-JWT signing, KB-JWT |
| ML-KEM-768 (Kyber) | ECDH-ES | JARM encryption, future credential issuance key wrapping |
| SHA3-256 (SHAKE256) | SHA-256 | SD-JWT disclosure digests, KB-JWT sd_hash |

---

## Key Dependencies to Watch

- **Android StrongBox**: Google roadmap for ML-DSA/ML-KEM in StrongBox TEE
- **jose (npm)**: PQC support not yet available — monitor [@panva/jose](https://github.com/panva/jose)
- **nimbus-jose-jwt**: PQC experimental support expected 2026
- **ETSI TS 119 182-x series**: New JAdES PQC profile under development

---

## References

- [NIST PQC Standards](https://csrc.nist.gov/projects/post-quantum-cryptography/post-quantum-cryptography-standardization)
- [ENISA PQC Migration Guidelines](https://www.enisa.europa.eu/publications/post-quantum-cryptography)
- [ETSI/CEN Workshop PQC for eIDAS (2025)](https://docbox.etsi.org/esi/Open/workshops/)
- [eIDAS 2.0 cryptography requirements](https://eu-digital-identity-wallet.github.io/eudi-doc-architecture-and-reference-framework/2.5.0/)
```

**Step 2: Commit**

```bash
cd C:/dev/eguilde
git add docs/compliance/pqc-roadmap.md
git commit -m "docs(compliance): add PQC migration roadmap (CR-04)

Documents current algorithm inventory, NIST FIPS 203/204/205 timeline,
hybrid migration strategy targeting 2027-2028, and per-component
algorithm replacement plan."
```

---

## Task 13: Update ARF HLR checklist to reflect fixes

**Files:**
- Modify: `C:/dev/eguilde/docs/compliance/arf-hlr-checklist.md`

**Step 1: Update the status of fixed items**

Change the following rows in the checklist:

| HLR ID | Old Status | New Status |
|---|---|---|
| PS-01 | ❌ | ✅ (HMAC pseudonym service) |
| PS-02 | ❌ | ✅ (RP-specific derivation) |
| PS-03 | ❌ | ✅ (HTTP endpoint + OpenID4VP integration) |
| PI-03 | ❌ | ✅ (HAIP 1.0 declared + direct_post.jwt) |
| PI-02 | ⚠️ | ✅ (JWT verified + DCQL-only) |
| CR-04 | ❌ | ✅ (roadmap document created) |

Also update the Gap Analysis Summary table counts and remove resolved items from the Priority Gap List.

**Step 2: Commit**

```bash
cd C:/dev/eguilde
git add docs/compliance/arf-hlr-checklist.md
git commit -m "docs(compliance): update HLR checklist — P1 gaps resolved

PS-01/02/03 ✅, PI-02 ✅, PI-03 ✅, CR-04 ✅ after implementation."
```

---

## Final Verification

**Step 1: Run all wallet-provider tests**

```bash
cd C:/dev/eguwallet-wallet-provider
npm test --no-coverage
```

Expected: All tests pass, no regressions.

**Step 2: Build Android**

```bash
cd C:/dev/eguwallet-android
./gradlew assembleDebug
```

Expected: BUILD SUCCESSFUL

**Step 3: Push all repos**

```bash
cd C:/dev/eguwallet-wallet-provider && git push
cd C:/dev/eguwallet-android && git push
cd C:/dev/eguilde && git push
```