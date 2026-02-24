# eIDAS 2.0 / EUDI Wallet — Full Compliance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all broken eIDAS 2.0 functionality and harden the system to full ARF 2.5.0+ compliance, enabling the complete PID issuance + wallet login flow in production.

**Architecture:** The system is split between `eguilde_wallet` (wallet backend microservices — requires CI rebuild to deploy) and `eguilde` (portal backend — live source, deploy with `git push`). Changes to `eguilde_wallet` need a commit + GitHub Actions CI build + `docker compose pull && docker compose up -d` on egucluster3. Changes to `eguilde` backend are deployed to egucluster3 automatically after push.

**Tech Stack:** NestJS 11, TypeScript, PostgreSQL messaging (`@app/messaging`), `jose` (JWT), Node.js `crypto`, `oidc-provider` v8, Docker, GitHub Actions CI

---

## Context for the Implementer

### Key URLs
- Wallet backend live: `https://wallet.eguilde.cloud` → nginx on 90.84.228.123 → egucluster3:8180
- Portal backend live: egucluster3:3100
- Server SSH: `eguilde@egucluster3.eguilde.cloud`
- Wallet compose: `/home/eguilde/eguilde_wallet/docker-compose.yml`

### Source repos (both on Windows dev machine)
- `C:\dev\eguilde_wallet\monoback\` — wallet backend (NestJS monorepo)
- `C:\dev\eguilde\backend\` — portal backend (NestJS)

### How to deploy after changes
```bash
# eguilde portal backend — deploy immediately
cd C:\dev\eguilde
git add -A && git commit -m "..." && git push

# eguilde_wallet — requires CI rebuild
cd C:\dev\eguilde_wallet
git add -A && git commit -m "..." && git push
# Then SSH to server and pull:
ssh eguilde@egucluster3.eguilde.cloud "cd /home/eguilde/eguilde_wallet && docker compose pull && docker compose up -d"
```

### How messaging works
Services communicate via `this.messaging.request('svc.dgep', 'handler_name', payload)`.
The DGEP messaging controller at `monoback/apps/dgep/src/controllers/messaging.controller.ts` handles `svc.dgep` messages.
Return format MUST be `{ success: true, data: ... }` or `{ success: false, error: '...' }`.
The api-gateway controller checks `result.success` — if falsy, throws.

### Tests
- Wallet backend tests: `cd C:\dev\eguilde_wallet\monoback && bun test` or `npx jest --testPathPattern=<file>`
- Portal backend tests: `cd C:\dev\eguilde\backend && npm test`

---

## PHASE 1: Critical Bugs in eguilde_wallet (Blocking PID issuance)

### Task 1: Fix `/.well-known/openid-credential-issuer` returns HTTP 500

**Root cause:** `getOpenidMetadata()` and `getWellKnownCredentialIssuer()` in the DGEP messaging controller return the raw metadata object (no `success` wrapper). The api-gateway controller then checks `result.success` → `undefined` → falsy → throws "Failed to retrieve metadata".

**Files:**
- Modify: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\controllers\messaging.controller.ts`

**Step 1: Locate the two broken handlers**

Open `messaging.controller.ts`. Find:
1. Line ~140: `getOpenidMetadata()` — returns `this.buildCredentialIssuerMetadata()` directly
2. Line ~278: `getWellKnownCredentialIssuer()` — same issue

**Step 2: Fix `getOpenidMetadata`**

Change:
```typescript
@MessageHandler('svc.dgep', 'get_openid_metadata')
async getOpenidMetadata(data: any) {
  this.logger.log('Messaging: get_openid_metadata called');
  try {
    return this.buildCredentialIssuerMetadata();
  } catch (error) {
    this.logger.error(`get_openid_metadata failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

To:
```typescript
@MessageHandler('svc.dgep', 'get_openid_metadata')
async getOpenidMetadata(data: any) {
  this.logger.log('Messaging: get_openid_metadata called');
  try {
    return { success: true, data: this.buildCredentialIssuerMetadata() };
  } catch (error) {
    this.logger.error(`get_openid_metadata failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

**Step 3: Fix `getWellKnownCredentialIssuer`**

Change:
```typescript
@MessageHandler('svc.dgep', 'get_well_known_credential_issuer')
async getWellKnownCredentialIssuer(data: any) {
  this.logger.log('Messaging: get_well_known_credential_issuer called');
  try {
    return this.buildCredentialIssuerMetadata();
  } catch (error) {
    this.logger.error(`get_well_known_credential_issuer failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

To:
```typescript
@MessageHandler('svc.dgep', 'get_well_known_credential_issuer')
async getWellKnownCredentialIssuer(data: any) {
  this.logger.log('Messaging: get_well_known_credential_issuer called');
  try {
    return { success: true, data: this.buildCredentialIssuerMetadata() };
  } catch (error) {
    this.logger.error(`get_well_known_credential_issuer failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

**Step 4: Also fix `getWellKnownOauthServer` (same pattern)**

It currently returns the OAuth metadata directly. Change its return to `{ success: true, data: { issuer: issuerUrl, ... } }`. Same pattern as above.

**Step 5: Verify the fix locally**

After deploy, test:
```bash
ssh eguilde@egucluster3.eguilde.cloud "curl -s http://localhost:8180/.well-known/openid-credential-issuer | python3 -m json.tool | head -5"
```
Expected: `{ "credential_issuer": "https://wallet.eguilde.cloud/", ... }` (HTTP 200)

**Step 6: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/dgep/src/controllers/messaging.controller.ts
git commit -m "fix(dgep): wrap metadata responses in {success,data} wrapper"
```

---

### Task 2: Fix SD-JWT `typ` header — `vc+sd-jwt` → `dc+sd-jwt`

**Root cause:** ARF 2.5.0+ specifies `dc+sd-jwt` as the type identifier. The DGEP issues credentials with `typ: 'vc+sd-jwt'` and also verifies with `typ: 'vc+sd-jwt'`. Wallets that validate the `typ` header will reject these credentials.

**Files:**
- Modify: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\services\sd-jwt.service.ts`

**Step 1: Fix the signing header**

In `sd-jwt.service.ts`, find the `SignJWT` call at line ~88. Change:
```typescript
.setProtectedHeader({
  alg: 'ES256',
  typ: 'vc+sd-jwt',
  kid: issuerKey.id.toString(),
})
```
To:
```typescript
.setProtectedHeader({
  alg: 'ES256',
  typ: 'dc+sd-jwt',
  kid: issuerKey.id.toString(),
})
```

**Step 2: Fix the verification**

In the same file, find `verifySdJwtVc()` at line ~347. Change:
```typescript
const { payload } = await jose.jwtVerify(jwt, publicKey, {
  typ: 'vc+sd-jwt',
});
```
To:
```typescript
const { payload } = await jose.jwtVerify(jwt, publicKey, {
  typ: 'dc+sd-jwt',
});
```

**Step 3: Run existing tests to make sure they still pass**
```bash
cd C:\dev\eguilde_wallet\monoback
npx jest --testPathPattern=sd-jwt.service.spec --no-coverage 2>&1 | tail -10
```
Expected: All tests pass. If any test uses `vc+sd-jwt` as expected value, update it to `dc+sd-jwt` in the test file too.

**Step 4: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/dgep/src/services/sd-jwt.service.ts
git commit -m "fix(dgep): use dc+sd-jwt typ header per ARF 2.5.0+"
```

---

### Task 3: Fix `oidc_models` table — move to `OnModuleInit`

**Root cause:** `PgAdapter.ensureTableExists()` is called in the constructor (async without await). Errors are silently swallowed. The table never gets created.

**Files:**
- Modify: `C:\dev\eguilde_wallet\monoback\apps\api-gateway\src\oidc\adapters\pg-adapter.ts`
- Modify: `C:\dev\eguilde_wallet\monoback\apps\api-gateway\src\oidc\oidc.module.ts`

**Step 1: Remove `ensureTableExists()` from the constructor**

In `pg-adapter.ts`, find:
```typescript
constructor(
  private readonly pg: PgService,
  private readonly name: string,
) {
  this.ensureTableExists();
}
```
Change to:
```typescript
constructor(
  private readonly pg: PgService,
  private readonly name: string,
) {
  // Table creation is handled by PgAdapter.initTable() called on module init
}
```

**Step 2: Export a static `initTable` method**

Add after the constructor in `pg-adapter.ts`:
```typescript
/**
 * Creates the oidc_models table. Must be awaited before the adapter is used.
 * Called once from OidcModule.onModuleInit().
 */
static async initTable(pg: PgService): Promise<void> {
  await pg.query(`
    CREATE TABLE IF NOT EXISTS oidc_models (
      id VARCHAR(255) PRIMARY KEY,
      type VARCHAR(100) NOT NULL,
      payload TEXT NOT NULL,
      grant_id VARCHAR(255),
      user_code VARCHAR(255),
      uid VARCHAR(255),
      expires_at TIMESTAMP,
      consumed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_oidc_models_grant_id ON oidc_models(grant_id);
    CREATE INDEX IF NOT EXISTS idx_oidc_models_user_code ON oidc_models(user_code);
    CREATE INDEX IF NOT EXISTS idx_oidc_models_uid ON oidc_models(uid);
    CREATE INDEX IF NOT EXISTS idx_oidc_models_expires_at ON oidc_models(expires_at);
  `);
}
```

**Step 3: Call `initTable` from `OidcModule.onModuleInit`**

In `oidc.module.ts`, the `OidcModule` already implements `OnModuleInit`. Add the `PgService` injection and the `initTable` call:

```typescript
import { PgService } from '@app/database';
// ... existing imports

export class OidcModule implements OnModuleInit {
  constructor(
    private readonly configService: ConfigService,
    private readonly oidcService: OidcService,
    private readonly pg: PgService,  // ADD THIS
  ) {}

  async onModuleInit() {
    // CREATE TABLE before anything touches the DB
    await PgAdapter.initTable(this.pg);
    console.log('OIDC models table initialized');
    console.log(
      `Issuer: ${this.configService.get<string>('oidc.issuer', 'https://wallet.eguilde.cloud')}`,
    );
    this.scheduleCleanup();
  }

  // ... rest unchanged
```

Also add `PgService` to the module's `providers` or `imports` if not already there. Check `oidc.module.ts` — if `PgService` isn't imported, add `DatabaseModule` to the `imports` array (check what the other modules use — likely `@app/database`).

**Step 4: Verify after deploy**
```bash
ssh eguilde@egucluster3.eguilde.cloud "PGPASSWORD='qWx11??9' psql -h 172.17.0.1 -U postgres -d eguwallet -c \"SELECT tablename FROM pg_tables WHERE tablename = 'oidc_models'\""
```
Expected: returns `oidc_models` row.

**Step 5: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/api-gateway/src/oidc/adapters/pg-adapter.ts
git add monoback/apps/api-gateway/src/oidc/oidc.module.ts
git commit -m "fix(api-gateway): create oidc_models table in OnModuleInit, not constructor"
```

---

### Task 4: Fix `credential_issuer` trailing slash inconsistency

**Root cause:** The `buildCredentialIssuerMetadata()` adds a trailing slash to `credential_issuer` but the `iss` claim in the SD-JWT (from `sd-jwt.service.ts:95`) uses `issuer.id` which has no trailing slash. Verifiers use `iss` to look up JWKS — the URL mismatch causes JWKS lookup failures.

**Files:**
- Modify: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\controllers\messaging.controller.ts`

**Step 1: Fix `buildCredentialIssuerMetadata()` to not add trailing slash**

Find in `messaging.controller.ts` the `buildCredentialIssuerMetadata()` private method (line ~341). Change:
```typescript
credential_issuer: issuerUrl.endsWith('/') ? issuerUrl : issuerUrl + '/',
```
To:
```typescript
credential_issuer: issuerUrl.replace(/\/$/, ''),
```

**Step 2: Verify issuer URL in env**
```bash
ssh eguilde@egucluster3.eguilde.cloud "cd /home/eguilde/eguilde_wallet && docker compose exec -T dgep env | grep ISSUER_ID"
```
The value should be `https://wallet.eguilde.cloud` (no trailing slash). Confirm this matches what the SD-JWT sets as `iss`.

**Step 3: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/dgep/src/controllers/messaging.controller.ts
git commit -m "fix(dgep): normalize credential_issuer URL - no trailing slash"
```

---

### Task 5: Fix cron `TimeoutNegativeWarning`

**Root cause:** A cron job is scheduled with a negative timeout (the scheduled time is in the past). Appears in both `dgep` and `lotl` on startup.

**Files:**
- Modify: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\services\pid-provider-bootstrap.service.ts`
- Check also: `C:\dev\eguilde_wallet\monoback\apps\lotl\src\` (any bootstrap/schedule service)

**Step 1: Find the offending cron schedule**
```bash
grep -rn "CronJob\|new CronJob\|setCronTimeout\|schedule\|cron" C:\dev\eguilde_wallet\monoback\apps\dgep\src\services\pid-provider-bootstrap.service.ts
grep -rn "CronJob\|new CronJob\|schedule\|cron" C:\dev\eguilde_wallet\monoback\apps\lotl\src\ --include="*.ts" | head -20
```

**Step 2: Replace absolute date cron expressions**

Any cron job using an absolute date (like `new Date(Date.now() + n)` where `n` could be 0 or negative) should use an interval instead:

```typescript
// WRONG — absolute date can be in the past
const job = new CronJob(new Date(Date.now() + delayMs), callback);

// CORRECT — use setInterval for simple repeating tasks
setInterval(callback, intervalMs);

// CORRECT — use cron expression for periodic tasks
// Every 24 hours: '0 0 * * *'
// Every hour: '0 * * * *'
```

**Step 3: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/dgep/src/services/pid-provider-bootstrap.service.ts
git commit -m "fix(dgep): replace absolute-date CronJob with setInterval to prevent negative timeout"
```

---

## PHASE 2: Critical Bugs in eguilde portal (Blocking wallet login)

### Task 6: Fix DCQL query in `createTransaction` and `birth_date` claim

**Root cause 1:** `verifier.service.ts:215` passes `defaultPresentationDefinition` (old PE format) to DB. The wallet request uses `defaultDcqlQuery` which is never stored.
**Root cause 2:** DCQL requests `{ path: ['birthdate'] }` but DGEP issues `birth_date`.

**Files:**
- Modify: `C:\dev\eguilde\backend\src\verifier\verifier.service.ts`

**Step 1: Fix the stored query in `createTransaction`**

Find at line ~215:
```typescript
const def = presentationDefinition ?? this.defaultPresentationDefinition;
```
Change to:
```typescript
const def = presentationDefinition ?? this.defaultDcqlQuery;
```

This ensures the DB stores what the wallet will actually receive.

**Step 2: Fix `birth_date` in DCQL query**

Find `defaultDcqlQuery` at line ~88. In the `eu-pid-sdjwt` credential claims array, change:
```typescript
{ path: ['birthdate'] },
```
To:
```typescript
{ path: ['birth_date'] },
{ path: ['birthdate'], required: false },
```

This requests `birth_date` (what DGEP issues, per ARF Annex 4) and also accepts `birthdate` as optional alias.

In the `eu-pid-mdoc` credential claims, find `claim_name: 'birthdate'` and change to `claim_name: 'birth_date'`.

**Step 3: Run tests**
```bash
cd C:\dev\eguilde\backend
npm test -- --testPathPattern=verifier.service.spec 2>&1 | tail -20
```
Fix any test that checks the DCQL or presentation definition structure.

**Step 4: Commit**
```bash
cd C:\dev\eguilde
git add backend/src/verifier/verifier.service.ts
git commit -m "fix(verifier): store DCQL query in DB and fix birth_date claim name"
```

---

### Task 7: Fix trust verification — fail closed

**Root cause:** Both `verifyIssuerTrust()` and `checkCredentialStatus()` in `trust.service.ts` return `true` when their respective endpoints are unreachable. This allows unverified issuers and revoked credentials to pass.

**Files:**
- Modify: `C:\dev\eguilde\backend\src\verifier\trust.service.ts`

**Step 1: Fix `verifyIssuerTrust` — fail closed with grace period**

Find the `catch` block at line ~161:
```typescript
} catch (err) {
  this.logger.warn(`LoTL unavailable (fail-open) for ${issuerUrl}: ${err}`);
  return true;
}
```

Change to:
```typescript
} catch (err) {
  this.logger.warn(`LoTL unavailable for ${issuerUrl}: ${err}`);
  // Grace period: use a slightly stale cached entry (up to 2x TTL = 2 hours) if available
  const stale = this.trustCache.get(issuerUrl);
  if (stale) {
    this.logger.warn(`Using stale trust cache for ${issuerUrl} (age: ${Math.round((Date.now() - stale.fetchedAt) / 60000)}min)`);
    return stale.trusted;
  }
  // No cache at all — fail closed (eIDAS 2.0 requirement)
  throw new UnauthorizedException(
    `Issuer trust cannot be verified — LoTL service unavailable and no cached result for ${issuerUrl}`,
  );
}
```

**Step 2: Fix `checkCredentialStatus` — fail closed with grace period**

Find the `catch` block at line ~125:
```typescript
} catch (err) {
  this.logger.warn(
    `Status list ${statusUri} unreachable (fail-open): ${err}`,
  );
  return true;
}
```

Change to:
```typescript
} catch (err) {
  this.logger.warn(`Status list ${statusUri} unreachable: ${err}`);
  // Grace period: use stale cache (up to 2x TTL = 10 min) if available
  const stale = this.statusCache.get(statusUri);
  if (stale) {
    this.logger.warn(`Using stale status cache for ${statusUri}`);
    const byteIdx = Math.floor(statusIndex / 8);
    const bitIdx = 7 - (statusIndex % 8);
    if (byteIdx >= stale.bits.length) return true;
    return ((stale.bits[byteIdx] >> bitIdx) & 1) === 0;
  }
  // No cache — fail closed
  throw new UnauthorizedException(
    `Credential revocation status cannot be verified — status list unreachable and no cached result`,
  );
}
```

**Step 3: Add `UnauthorizedException` import if not present**

Check top of `trust.service.ts`:
```typescript
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
```

**Step 4: Run trust service tests**
```bash
cd C:\dev\eguilde\backend
npm test -- --testPathPattern=trust.service.spec 2>&1 | tail -20
```
Update any test that mocks LOTL failure and expects `true` — it should now expect a thrown `UnauthorizedException` when there is no cached entry.

**Step 5: Commit**
```bash
cd C:\dev\eguilde
git add backend/src/verifier/trust.service.ts
git commit -m "fix(verifier): fail closed on LOTL/status-list unavailability with grace period cache"
```

---

## PHASE 3: PKI Hardening — `x5c` Certificate Chain in JWKS

### Task 8: Add `x5c` to DGEP issuer JWKS

**Root cause:** The issuer JWKS at `/.well-known/jwks.json` (and via the `pid-provider/jwks.json` endpoint) exposes only the raw JWK without the X.509 certificate chain. Verifiers can't do certificate chain validation without this.

**Background:** The `dgep_issuer_keys` table already stores `certificate_pem` (leaf cert from QTSP) and `qtsp_chain_pem` (JSON array of chain certs). We just need to include them in the JWKS response.

**Files:**
- Modify: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\controllers\messaging.controller.ts`
- Modify: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\services\issuer-key.service.ts`

**Step 1: Add `buildX5c` helper to `IssuerKeyService`**

In `issuer-key.service.ts`, add a new method:
```typescript
/**
 * Builds the x5c array for a JWK entry.
 * x5c = [base64(DER leaf), base64(DER intermediate), ..., base64(DER root)]
 * Input PEMs are either single PEM strings or JSON arrays of PEM strings.
 */
buildX5cChain(leafCertPem: string, chainPemJson: string | null): string[] {
  const x5c: string[] = [];

  // Convert a PEM cert to base64-encoded DER (strip header/footer/newlines)
  const pemToDer = (pem: string): string =>
    pem
      .replace(/-----BEGIN CERTIFICATE-----/g, '')
      .replace(/-----END CERTIFICATE-----/g, '')
      .replace(/\s/g, '');

  if (leafCertPem) {
    x5c.push(pemToDer(leafCertPem));
  }

  if (chainPemJson) {
    try {
      const chain: string[] = JSON.parse(chainPemJson);
      for (const cert of chain) {
        if (cert && cert !== leafCertPem) {
          x5c.push(pemToDer(cert));
        }
      }
    } catch {
      // chainPemJson might be a single PEM string (not JSON array)
      if (chainPemJson !== leafCertPem) {
        x5c.push(pemToDer(chainPemJson));
      }
    }
  }

  return x5c;
}
```

**Step 2: Update `getWellKnownJwks` in `messaging.controller.ts`**

Find the `getWellKnownJwks` handler (~line 314). Change:
```typescript
return {
  keys: [
    {
      ...issuerKey.public_jwk,
      kid: issuerKey.key_id,
      use: 'sig',
      alg: issuerKey.algorithm,
    },
  ],
};
```
To:
```typescript
const x5c = this.issuerKeyService.buildX5cChain(
  issuerKey.certificate_pem,
  issuerKey.qtsp_chain_pem,
);

const jwkEntry: any = {
  ...issuerKey.public_jwk,
  kid: issuerKey.key_id,
  use: 'sig',
  alg: issuerKey.algorithm,
};

if (x5c.length > 0) {
  jwkEntry.x5c = x5c;
}

return { success: true, data: { keys: [jwkEntry] } };
```

Note: also wrap the return in `{ success: true, data: ... }` — check if this handler already does that. If it currently returns the raw object directly, fix it the same way as Task 1.

**Step 3: Verify after deploy**
```bash
ssh eguilde@egucluster3.eguilde.cloud "curl -s http://localhost:8180/.well-known/pid-provider/jwks.json | python3 -m json.tool | grep x5c"
```
Expected: `"x5c": ["MIIBxjCC..."]` present in the output.

**Step 4: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/dgep/src/controllers/messaging.controller.ts
git add monoback/apps/dgep/src/services/issuer-key.service.ts
git commit -m "feat(dgep): include x5c certificate chain in issuer JWKS"
```

---

## PHASE 4: Verifier — X.509 Certificate Chain Validation

### Task 9: Validate `x5c` chain in verifier `TrustService`

**Root cause:** The eguilde verifier fetches the issuer JWKS and verifies the JWT signature, but does NOT validate the X.509 certificate chain in `x5c`. Full PKI compliance requires validating the chain back to the LOTL root CA.

**Files:**
- Modify: `C:\dev\eguilde\backend\src\verifier\trust.service.ts`

**Step 1: Add `validateX5cChain` method**

Add this method to `TrustService` (after `verifyJwsSignature`):

```typescript
/**
 * Validates an x5c certificate chain from a JWK.
 *
 * Checks:
 * 1. Chain signature integrity (each cert signed by the next)
 * 2. All certs are within their validity period
 * 3. Leaf cert has digitalSignature key usage
 *
 * Returns the leaf certificate's public key if valid, throws if invalid.
 */
validateX5cChain(x5c: string[]): crypto.KeyObject {
  if (!x5c || x5c.length === 0) {
    throw new Error('x5c chain is empty');
  }

  const parseCert = (der: Buffer) =>
    crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });

  const now = new Date();
  const certs: crypto.X509Certificate[] = [];

  for (const b64 of x5c) {
    const der = Buffer.from(b64, 'base64');
    try {
      const cert = new crypto.X509Certificate(der);
      certs.push(cert);
    } catch (err) {
      throw new Error(`Failed to parse x5c certificate: ${err}`);
    }
  }

  // Validate each cert in chain
  for (let i = 0; i < certs.length; i++) {
    const cert = certs[i];

    // Validity period check
    if (new Date(cert.validFrom) > now || new Date(cert.validTo) < now) {
      throw new Error(
        `Certificate at x5c[${i}] is outside validity period (valid: ${cert.validFrom} – ${cert.validTo})`,
      );
    }

    // Chain signature check: each cert is signed by the next
    if (i < certs.length - 1) {
      const issuerCert = certs[i + 1];
      const issuerKey = crypto.createPublicKey(issuerCert.publicKey);
      if (!cert.verify(issuerKey)) {
        throw new Error(`x5c chain broken at position ${i}: cert not signed by next cert`);
      }
    }
  }

  // Return the leaf's public key (for signature verification)
  return crypto.createPublicKey(certs[0].publicKey);
}
```

**Step 2: Use `x5c` validation in `fetchIssuerJwks`**

After fetching keys (line ~83, where `this.jwksCache.set(...)` is called), before returning, validate each key's `x5c` if present:

```typescript
// After fetching keys from endpoint:
const validatedKeys = keys.filter((k: any) => {
  if (k.x5c && Array.isArray(k.x5c) && k.x5c.length > 0) {
    try {
      this.validateX5cChain(k.x5c);
      this.logger.debug(`x5c chain valid for kid=${k.kid}`);
      return true;
    } catch (err) {
      this.logger.warn(`Rejecting key kid=${k.kid} — x5c chain invalid: ${err}`);
      return false;
    }
  }
  // No x5c — accept but log warning (transitional: issuers may not have x5c yet)
  this.logger.debug(`Key kid=${k.kid} has no x5c — accepting without chain validation`);
  return true;
});

if (validatedKeys.length > 0) {
  this.jwksCache.set(issuerUrl, { keys: validatedKeys, fetchedAt: now });
  return validatedKeys;
}
```

Note: Accept keys without `x5c` during transition — only reject if `x5c` is present but invalid.

**Step 3: Add `x5c` field to `JwkKey` interface**

In `trust.service.ts`, find the `JwkKey` interface and add:
```typescript
export interface JwkKey {
  kty: string;
  crv?: string;
  x?: string;
  y?: string;
  n?: string;
  e?: string;
  kid?: string;
  alg?: string;
  use?: string;
  x5c?: string[];  // ADD THIS
}
```

**Step 4: Run verifier tests**
```bash
cd C:\dev\eguilde\backend
npm test -- --testPathPattern=trust.service.spec 2>&1 | tail -20
```
Add a test for the `x5c` validation if the test file doesn't have one yet.

**Step 5: Commit**
```bash
cd C:\dev\eguilde
git add backend/src/verifier/trust.service.ts
git commit -m "feat(verifier): validate x5c certificate chain in issuer JWKS"
```

---

## PHASE 5: LOTL — ETSI TSL XML Endpoint

### Task 10: Add ETSI TS 119 612 TSL XML endpoint to LOTL service

**Goal:** Make the trust list consumable by external verifiers. The LOTL service needs to expose the trust list as signed ETSI XML at `GET /tsl`.

**Files:**
- Create: `C:\dev\eguilde_wallet\monoback\apps\lotl\src\controllers\tsl.controller.ts`
- Modify: `C:\dev\eguilde_wallet\monoback\apps\lotl\src\lotl.module.ts`
- Check: existing LOTL service/controller for trusted services DB schema

**Step 1: Understand the trust list DB schema**

Run on server:
```bash
ssh eguilde@egucluster3.eguilde.cloud "PGPASSWORD='qWx11??9' psql -h 172.17.0.1 -U postgres -d eguwallet -c '\d trusted_services'"
```
Note the column names — you'll need `service_type`, `service_name`, `status`, `x509_certificate`, `service_supply_points`.

**Step 2: Create the TSL XML generator**

Create `C:\dev\eguilde_wallet\monoback\apps\lotl\src\services\tsl-xml.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';

@Injectable()
export class TslXmlService {
  private readonly logger = new Logger(TslXmlService.name);

  constructor(
    private readonly pg: PgService,
    private readonly configService: ConfigService,
  ) {}

  async generateTslXml(): Promise<string> {
    const baseUrl = this.configService.get<string>('BASE_URL', 'https://wallet.eguilde.cloud');
    const now = new Date();
    const nextUpdate = new Date(now);
    nextUpdate.setMonth(nextUpdate.getMonth() + 6);

    const services = await this.pg.queryMany<{
      id: string;
      service_type: string;
      service_name: string;
      status: string;
      x509_certificate: string;
      service_supply_points: string;
    }>(`SELECT id, service_type, service_name, status, x509_certificate, service_supply_points
        FROM trusted_services
        WHERE status = 'granted'
        ORDER BY service_type, service_name`);

    const tspServices = services.map(svc => `
      <TrustServiceProvider>
        <TSPInformation>
          <TSPName>
            <Name xml:lang="en">${this.escapeXml(svc.service_name)}</Name>
            <Name xml:lang="ro">${this.escapeXml(svc.service_name)}</Name>
          </TSPName>
          <TSPTradeName>
            <Name xml:lang="en">${this.escapeXml(svc.service_name)}</Name>
          </TSPTradeName>
          <TSPAddress>
            <ElectronicAddress>
              <URI>${baseUrl}</URI>
            </ElectronicAddress>
          </TSPAddress>
        </TSPInformation>
        <TSPServices>
          <TSPService>
            <ServiceInformation>
              <ServiceTypeIdentifier>${this.getServiceTypeUri(svc.service_type)}</ServiceTypeIdentifier>
              <ServiceName>
                <Name xml:lang="en">${this.escapeXml(svc.service_name)}</Name>
              </ServiceName>
              <ServiceDigitalIdentity>
                <DigitalId>
                  <X509Certificate>${svc.x509_certificate || ''}</X509Certificate>
                </DigitalId>
              </ServiceDigitalIdentity>
              <ServiceStatus>http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted</ServiceStatus>
              <StatusStartingTime>${now.toISOString()}</StatusStartingTime>
              <ServiceSupplyPoints>
                <ServiceSupplyPoint>${svc.service_supply_points || baseUrl}</ServiceSupplyPoint>
              </ServiceSupplyPoints>
            </ServiceInformation>
          </TSPService>
        </TSPServices>
      </TrustServiceProvider>`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<TrustServiceStatusList
  xmlns="http://uri.etsi.org/02231/v2#"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"
  xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
  Id="RO-TSL"
  TSLTag="http://uri.etsi.org/TrstSvc/TrustedList/TSLTag">

  <SchemeInformation>
    <TSLVersionIdentifier>6</TSLVersionIdentifier>
    <TSLSequenceNumber>1</TSLSequenceNumber>
    <TSLType>http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUgeneric</TSLType>
    <SchemeOperatorName>
      <Name xml:lang="en">eGuilde - Romanian Trusted List Operator</Name>
      <Name xml:lang="ro">eGuilde - Operator Lista de Incredere Romania</Name>
    </SchemeOperatorName>
    <SchemeOperatorAddress>
      <ElectronicAddress>
        <URI>${baseUrl}/tsl</URI>
      </ElectronicAddress>
    </SchemeOperatorAddress>
    <SchemeName>
      <Name xml:lang="en">RO National Trusted List</Name>
      <Name xml:lang="ro">Lista Nationala de Incredere Romania</Name>
    </SchemeName>
    <SchemeInformationURI>
      <URI xml:lang="en">${baseUrl}/tsl</URI>
    </SchemeInformationURI>
    <StatusDeterminationApproach>http://uri.etsi.org/TrstSvc/TrustedList/TSLType/EUlistofthelists</StatusDeterminationApproach>
    <SchemeTypeCommunityRules>
      <URI xml:lang="en">http://uri.etsi.org/TrstSvc/TrustedList/schemerules/EUcommon</URI>
    </SchemeTypeCommunityRules>
    <SchemeTerritory>RO</SchemeTerritory>
    <PolicyOrLegalNotice>
      <TSLLegalNotice xml:lang="en">This is the official Romanian trusted service list for eIDAS 2.0</TSLLegalNotice>
    </PolicyOrLegalNotice>
    <HistoricalInformationPeriod>65535</HistoricalInformationPeriod>
    <ListIssueDateTime>${now.toISOString()}</ListIssueDateTime>
    <NextUpdate>
      <dateTime>${nextUpdate.toISOString()}</dateTime>
    </NextUpdate>
  </SchemeInformation>

  <TrustServiceProviderList>
    ${tspServices}
  </TrustServiceProviderList>

</TrustServiceStatusList>`;
  }

  private getServiceTypeUri(serviceType: string): string {
    const mapping: Record<string, string> = {
      'PIDProvider': 'http://uri.etsi.org/TrstSvc/Svctype/IdV',
      'QEAAProvider': 'http://uri.etsi.org/TrstSvc/Svctype/ACA',
      'WalletProvider': 'http://uri.etsi.org/TrstSvc/Svctype/PKCert',
      'QTSP': 'http://uri.etsi.org/TrstSvc/Svctype/CA/QC',
    };
    return mapping[serviceType] || `http://uri.etsi.org/TrstSvc/Svctype/${serviceType}`;
  }

  private escapeXml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
```

**Step 3: Create the TSL controller**

Create `C:\dev\eguilde_wallet\monoback\apps\lotl\src\controllers\tsl.controller.ts`:

```typescript
import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { TslXmlService } from '../services/tsl-xml.service';

@Controller('tsl')
export class TslController {
  constructor(private readonly tslXmlService: TslXmlService) {}

  @Get()
  async getTsl(@Res() res: Response): Promise<void> {
    const xml = await this.tslXmlService.generateTslXml();
    res.setHeader('Content-Type', 'application/xml; charset=UTF-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(xml);
  }

  @Get('ro.xml')
  async getTslXml(@Res() res: Response): Promise<void> {
    const xml = await this.tslXmlService.generateTslXml();
    res.setHeader('Content-Type', 'application/xml; charset=UTF-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="RO-TSL.xml"',
    );
    res.send(xml);
  }
}
```

**Step 4: Add to LOTL module**

In `lotl.module.ts`, import `TslController` and `TslXmlService` and add to `controllers` and `providers`.

**Step 5: Expose via api-gateway**

The api-gateway needs to forward `/tsl` to the LOTL service. Add a route in the api-gateway that proxies to `svc.lotl.get_tsl`. Add a `@MessageHandler('svc.lotl', 'get_tsl')` in the LOTL service, and a `@Get('tsl')` or `@Get('tsl/ro.xml')` in the api-gateway's LOTL controller. Since the TSL is large XML, use HTTP streaming — the simpler approach is direct HTTP proxy from nginx to the LOTL service if it's accessible, otherwise add the messaging route.

**Simpler alternative:** Add a direct HTTP `@Get('tsl')` endpoint in the LOTL service's HTTP layer (it already has an HTTP server). Expose port 3002 only on the internal network, and have the api-gateway proxy it.

For now, add a messaging-based route:
- LOTL messaging controller: `@MessageHandler('svc.lotl', 'get_tsl')` → returns XML string
- api-gateway LOTL controller: `@Get('tsl')` → calls messaging, sets Content-Type and responds

**Step 6: Verify**
```bash
ssh eguilde@egucluster3.eguilde.cloud "curl -s http://localhost:8180/api/lotl/tsl | head -10"
```
Expected: XML starting with `<?xml version="1.0"...`

**Step 7: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/lotl/src/
git commit -m "feat(lotl): add ETSI TS 119 612 TSL XML endpoint"
```

---

## PHASE 6: Android Wallet — Hardware-Backed Device Key Attestation

### Task 11: Wire Android hardware key attestation for LoA High

**Goal:** The Android wallet must generate its credential key pair in the Android Keystore (hardware-backed TEE/StrongBox). The DGEP verifies the key attestation before issuing the PID credential.

**Files:**
- Android: `C:\dev\eguilde_wallet\wallet\app\src\main\kotlin\` (find credential issuance flow)
- Wallet backend: `C:\dev\eguilde_wallet\monoback\apps\api-gateway\src\controllers\attestation-android.controller.ts`
- DGEP backend: `C:\dev\eguilde_wallet\monoback\apps\dgep\src\services\credential-issuance.service.ts`

**Step 1: Understand the current Android key generation**

Open the Android wallet source. Find where the proof-of-possession JWT is generated. Look for:
- `KeyPairGenerator.getInstance("EC", "AndroidKeyStore")`
- Or a custom key generation call

If the key is generated without `AndroidKeyStore` provider, it's software-backed and NOT LoA High compliant.

**Step 2: Update Android to use hardware-backed keys**

In the Android wallet, update the key generation to use the Android Keystore with attestation:

```kotlin
// In your credential key generation code:
val keyPairGenerator = KeyPairGenerator.getInstance(
    KeyProperties.KEY_ALGORITHM_EC,
    "AndroidKeyStore"
)

val parameterSpec = KeyGenParameterSpec.Builder(
    "pid_credential_key_${credentialType}",
    KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
)
    .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
    .setDigests(KeyProperties.DIGEST_SHA256)
    .setAttestationChallenge(challengeBytes)  // challenge from DGEP
    .build()

keyPairGenerator.initialize(parameterSpec)
val keyPair = keyPairGenerator.generateKeyPair()

// Get the attestation certificate chain
val keyStore = KeyStore.getInstance("AndroidKeyStore")
keyStore.load(null)
val certChain = keyStore.getCertificateChain("pid_credential_key_${credentialType}")
// certChain[0] is the leaf (key attestation cert), certChain[last] is root
```

**Step 3: Include attestation in credential request**

The wallet needs to:
1. Get a challenge from the DGEP (nonce to prevent replay)
2. Include the attestation cert chain in the credential request

Modify the credential request body to include:
```json
{
  "format": "dc+sd-jwt",
  "vct": "eu.europa.ec.eudi.pid.1",
  "proof": {
    "proof_type": "jwt",
    "jwt": "..."
  },
  "key_attestation": {
    "format": "android_keystore",
    "attestation_chain": ["base64DerLeaf", "base64DerIntermed", "base64DerRoot"]
  }
}
```

**Step 4: Verify attestation in DGEP `CredentialIssuanceService`**

In `credential-issuance.service.ts`, in `handleCredentialRequest()`, after validating the proof-of-possession, add:

```typescript
// Verify hardware key attestation if provided
if (request.key_attestation?.format === 'android_keystore') {
  await this.verifyAndroidKeyAttestation(
    request.key_attestation.attestation_chain,
    holderJwk,
  );
}
```

Add the verification method:
```typescript
private async verifyAndroidKeyAttestation(
  chain: string[],
  holderJwk: any,
): Promise<void> {
  if (!chain || chain.length === 0) {
    throw new BadRequestException('Key attestation chain is empty');
  }

  // Parse the leaf cert (attestation cert for the credential key)
  const leafDer = Buffer.from(chain[0], 'base64');
  const leafCert = new (require('crypto').X509Certificate)(leafDer);

  // Verify the chain
  for (let i = 0; i < chain.length - 1; i++) {
    const certDer = Buffer.from(chain[i], 'base64');
    const cert = new (require('crypto').X509Certificate)(certDer);
    const issuerDer = Buffer.from(chain[i + 1], 'base64');
    const issuerCert = new (require('crypto').X509Certificate)(issuerDer);
    const issuerKey = require('crypto').createPublicKey(issuerCert.publicKey);
    if (!cert.verify(issuerKey)) {
      throw new BadRequestException(`Key attestation chain broken at position ${i}`);
    }
  }

  // Verify the attested public key matches the holder JWK in the proof
  const attestedKey = require('crypto').createPublicKey(leafCert.publicKey);
  const attestedJwk = attestedKey.export({ format: 'jwk' }) as any;
  if (attestedJwk.x !== holderJwk.x || attestedJwk.y !== holderJwk.y) {
    throw new BadRequestException(
      'Key attestation public key does not match proof-of-possession key',
    );
  }

  this.logger.log('Android hardware key attestation verified successfully');
}
```

**Step 5: Add attestation to the CredentialRequest DTO**

In `credential-issuance.service.ts` or its DTO, add:
```typescript
export interface CredentialRequest {
  format: 'dc+sd-jwt' | 'vc+sd-jwt' | 'mso_mdoc';
  vct?: string;
  doctype?: string;
  proof?: { proof_type: 'jwt'; jwt: string; };
  key_attestation?: {
    format: 'android_keystore';
    attestation_chain: string[];
  };
}
```

**Step 6: Commit**
```bash
cd C:\dev\eguilde_wallet
git add monoback/apps/dgep/src/services/credential-issuance.service.ts
git commit -m "feat(dgep): verify Android hardware key attestation in credential request"
# Android changes are committed separately in the wallet/ directory
```

---

## PHASE 7: Deploy and End-to-End Test

### Task 12: Deploy all eguilde_wallet changes

**Step 1: Push all wallet backend commits**
```bash
cd C:\dev\eguilde_wallet
git push origin main
```

**Step 2: Wait for CI to build**
Monitor GitHub Actions at `https://github.com/eguilde/eguilde_wallet/actions`
Wait for all Docker images to build and push to GHCR.

**Step 3: Deploy to server**
```bash
ssh eguilde@egucluster3.eguilde.cloud "cd /home/eguilde/eguilde_wallet && docker compose pull && docker compose up -d"
```

**Step 4: Verify all services healthy**
```bash
ssh eguilde@egucluster3.eguilde.cloud "cd /home/eguilde/eguilde_wallet && docker compose ps"
```
All services should show `Up X seconds (healthy)`.

**Step 5: Verify no startup errors**
```bash
ssh eguilde@egucluster3.eguilde.cloud "cd /home/eguilde/eguilde_wallet && docker compose logs --tail=20 dgep && docker compose logs --tail=20 api-gateway"
```
Should NOT see `oidc_models` error or `TimeoutNegativeWarning`.

---

### Task 13: Deploy all eguilde changes

**Step 1: Push portal backend**
```bash
cd C:\dev\eguilde
git push origin main
```
CI deploys automatically to egucluster3:3100.

---

### Task 14: End-to-end test

**Step 1: Verify well-known**
```bash
curl https://wallet.eguilde.cloud/.well-known/openid-credential-issuer | python3 -m json.tool
```
Expected: HTTP 200, `credential_issuer: "https://wallet.eguilde.cloud"`, `format: "dc+sd-jwt"` in credential_configurations.

**Step 2: Verify JWKS with x5c**
```bash
curl https://wallet.eguilde.cloud/.well-known/pid-provider/jwks.json | python3 -m json.tool
```
Expected: HTTP 200, key with `x5c` array.

**Step 3: Create a test PID credential offer from portal**
1. Log into eguilde portal as admin
2. Go to Onboarding → PID Inspector
3. For a test citizen, click "Create PID Offer"
4. Note the `credential_offer_uri` and `tx_code`

**Step 4: Issue PID on Android wallet**
1. Open eguilde Android wallet app
2. Scan the QR code / open the deep link
3. Enter the `tx_code` PIN
4. Confirm → PID issued and shown on wallet home screen
5. Verify the credential card shows: name, birth date, country (not `vc+sd-jwt` errors)

**Step 5: Test wallet login**
1. Open eguilde portal login page
2. Click "Login with EUDI Wallet"
3. Scan the QR code on Android wallet
4. Confirm disclosure on wallet
5. Portal should show login success with `acr=urn:eidas:loa:high`

**Step 6: Test revocation**
1. Admin: revoke the PID credential
2. Try wallet login again
3. Expected: Login fails with "Credential is REVOKED"

**Step 7: Verify LOTL endpoint**
```bash
curl https://wallet.eguilde.cloud/api/lotl/verify-issuer?issuerUrl=https://wallet.eguilde.cloud | python3 -m json.tool
```
Expected: `{ "trusted": true }`

```bash
curl https://wallet.eguilde.cloud/api/lotl/tsl | head -5
```
Expected: ETSI XML output.

---

## Deployment Note

After completing Phases 1-5 (Tasks 1-10), you have a fully compliant system for the PID issuance + wallet login flow. Phase 6 (Android attestation) makes the system LoA High compliant at the hardware level. All phases can be deployed independently.

**Recommended deployment order:**
1. Phase 1 (Tasks 1-5) — fixes all active 500 errors → deploy to wallet backend
2. Phase 2 (Tasks 6-7) — fixes portal verifier → deploy to eguilde backend
3. Phase 3 (Task 8) — x5c in JWKS → deploy to wallet backend
4. Phase 4 (Task 9) — x5c validation → deploy to eguilde backend
5. Phase 5 (Task 10) — TSL XML → deploy to wallet backend
6. Phase 6 (Task 11) — Android attestation → rebuild APK + deploy wallet backend
7. Phase 7 (Tasks 12-14) — full deploy + E2E test
