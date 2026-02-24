# eIDAS 2.0 Compliance Gaps — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close four remaining compliance gaps found by the post-deployment audit so that `wallet.eguilde.cloud` is fully compliant as a national eIDAS 2.0 solution.

**Architecture:** All four fixes are in `C:\dev\eguilde_wallet\monoback` (wallet backend).
Fixes touch the api-gateway (token errors, well-known discovery, health) and the LOTL service
(self-registration of national services). No new dependencies needed.

**Tech Stack:** NestJS 10, PostgreSQL messaging (`@app/messaging`), TypeScript.

---

## Context — What the Audit Found

```
Score before: 23 PASS / 0 FAIL / 3 WARN
```

Four gaps to fix:

| # | Gap | Severity |
|---|-----|----------|
| 1 | `/token` errors use NestJS shape `{statusCode,message}` instead of RFC 6749 `{error,error_description}` | P1 — breaks EUDI wallet clients |
| 2 | `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server` return HTTP 404 | P2 — breaks OIDC federation discovery |
| 3 | `/health` returns 404 at tested path; no dependency checks | P3 — container probes can't detect degraded state |
| 4 | `wallet.eguilde.cloud` not listed in its own LOTL as a trusted service | P2 — blocks interoperability with other EU wallet implementations |

---

## Task 1: RFC 6749 Token Error Propagation

**Root cause:** The DGEP messaging handler (`openid_token`) catches errors and returns
`{ success: false, error: error.message }` — a plain string. The api-gateway receives this
and throws `HttpException(error.message, 400)`, which NestJS serialises as
`{"statusCode":400,"message":"..."}`. The RFC 6749 `error` code (`invalid_grant` etc.) is lost.

**Fix:** Pass the full OAuth error object through the messaging layer.

**Files:**
- Modify: `monoback/apps/dgep/src/controllers/messaging.controller.ts` (lines 157–164)
- Modify: `monoback/apps/api-gateway/src/controllers/dgep.controller.ts` (lines 155–170)
- Modify test: `monoback/apps/dgep/src/controllers/messaging.controller.spec.ts` (if it exists)

**Step 1: Write the failing test**

In `monoback/apps/api-gateway` there is no dedicated unit test for `requestToken` error
shape — verify by running:
```bash
cd /c/dev/eguilde_wallet/monoback
bun test apps/api-gateway 2>&1 | grep -i token | head -20
```
The absence of a test for error shape is the starting point.

**Step 2: Modify `messaging.controller.ts` — propagate OAuth error object**

Find the `openidToken` handler (line ~152). Currently:
```typescript
@MessageHandler('svc.dgep', 'openid_token')
async openidToken(data: any) {
  this.logger.log('Messaging: openid_token called');
  const payload = data.payload || data;
  try {
    const result = await this.tokenService.handleTokenRequest(payload, payload.dpopProof);
    return { success: true, data: result };
  } catch (error) {
    this.logger.error(`openid_token failed: ${error.message}`);
    return { success: false, error: error.message };          // ← loses RFC 6749 code
  }
}
```

Change the catch block to:
```typescript
  } catch (error) {
    this.logger.error(`openid_token failed: ${error.message}`);
    // Preserve RFC 6749 error object if the service threw an HttpException
    // with {error, error_description} body
    const oauthError =
      error?.response && typeof error.response === 'object' && error.response.error
        ? { error: error.response.error, error_description: error.response.error_description || error.message }
        : { error: 'server_error', error_description: error.message };
    return { success: false, oauthError };
  }
```

**Step 3: Modify `dgep.controller.ts` — forward RFC 6749 error**

Find the `requestToken` method (line ~155). Currently the error handler:
```typescript
  } catch (error) {
    await this.audit.logFailure('openid_token', 'api-gateway', 'dgep', error.message);
    throw new HttpException(error.message || 'Token request failed', HttpStatus.BAD_REQUEST);
  }
```

Replace the entire method body:
```typescript
@Public()
@Post('token')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Exchange pre-authorized code for access token' })
@ApiResponse({ status: 200, description: 'Access token issued' })
async requestToken(@Body() data: any, @Headers('dpop') dpopProof?: string) {
  const result = await this.messaging.request('svc.dgep', 'openid_token', { ...data, dpopProof });

  if (result && !result.success) {
    await this.audit.logFailure('openid_token', 'api-gateway', 'dgep', result.oauthError?.error_description || result.error);
    // Forward RFC 6749 error shape: {error, error_description}
    const oauthErr = result.oauthError ?? {
      error: 'invalid_request',
      error_description: result.error || 'Token request failed',
    };
    throw new HttpException(oauthErr, HttpStatus.BAD_REQUEST);
  }

  await this.audit.logSuccess('openid_token', 'api-gateway', 'dgep');
  return result?.data ?? result;
}
```

Note: `HttpException` with an **object** as first argument returns that object as the HTTP body
directly — exactly what RFC 6749 §5.2 requires.

**Step 4: Verify manually**

```bash
curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=INVALID"
```

Expected response body:
```json
{"error":"invalid_grant","error_description":"The pre-authorization code is invalid or expired"}
```
(No `statusCode` or `message` field.)

**Step 5: Build and check**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build dgep 2>&1 | tail -3
bun nest build api-gateway 2>&1 | tail -3
```

Both must show `compiled successfully`.

**Step 6: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/dgep/src/controllers/messaging.controller.ts \
        monoback/apps/api-gateway/src/controllers/dgep.controller.ts
git commit -m "fix(dgep): propagate RFC 6749 error shape through messaging layer

The token error response was using NestJS {statusCode,message} instead of
OAuth 2.0 RFC 6749 §5.2 {error,error_description}. Fix: messaging handler
now returns oauthError object; api-gateway forwards it directly as HTTP 400
body via HttpException(object, 400).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: OIDC / OAuth Well-Known Discovery at Standard Paths

**Root cause:** `/.well-known/openid-configuration` and `/.well-known/oauth-authorization-server`
return HTTP 404. These paths are required by RFC 8414 and OpenID Connect Discovery 1.0.
The `WellKnownController` only exposes `pid-provider/*` and `wallet-provider/*` sub-paths,
not the root-level standard discovery paths.

**Fix:** Add two endpoints to `WellKnownController` that return the OAuth Authorization Server
metadata for the wallet's credential issuance server.

**Files:**
- Modify: `monoback/apps/api-gateway/src/controllers/well-known.controller.ts`

**Step 1: Understand what the endpoints must return**

Per RFC 8414 §2, `/.well-known/oauth-authorization-server` must return:
```json
{
  "issuer": "https://wallet.eguilde.cloud",
  "token_endpoint": "https://wallet.eguilde.cloud/token",
  "jwks_uri": "https://wallet.eguilde.cloud/.well-known/pid-provider/jwks.json",
  "grant_types_supported": ["urn:ietf:params:oauth:grant-type:pre-authorized_code"],
  "token_endpoint_auth_methods_supported": ["none"],
  "dpop_signing_alg_values_supported": ["ES256", "ES384", "ES512"],
  "response_types_supported": ["token"],
  "code_challenge_methods_supported": ["S256"]
}
```

`/.well-known/openid-configuration` is the OIDC variant — same content.

**Step 2: Add ConfigService injection and two new GET handlers**

In `well-known.controller.ts`, the constructor currently only injects `MessagingService`.
Add `ConfigService` and two new handlers:

```typescript
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { MessagingService } from '@app/messaging';
import { Public } from '../decorators/public.decorator';

@Controller('.well-known')
@ApiTags('.well-known')
@Public()
export class WellKnownController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly config: ConfigService,
  ) {}

  // ── NEW: RFC 8414 OAuth Authorization Server Metadata ──────────────────────

  private buildAsMetadata() {
    const issuer = (this.config.get<string>('ISSUER_URL') || 'https://wallet.eguilde.cloud')
      .replace(/\/$/, '');
    return {
      issuer,
      token_endpoint: `${issuer}/token`,
      jwks_uri: `${issuer}/.well-known/pid-provider/jwks.json`,
      grant_types_supported: ['urn:ietf:params:oauth:grant-type:pre-authorized_code'],
      token_endpoint_auth_methods_supported: ['none'],
      dpop_signing_alg_values_supported: ['ES256', 'ES384', 'ES512'],
      response_types_supported: ['token'],
      code_challenge_methods_supported: ['S256'],
      authorization_response_iss_parameter_supported: true,
    };
  }

  @Get('oauth-authorization-server')
  @ApiOperation({ summary: 'RFC 8414 OAuth Authorization Server Metadata' })
  @ApiResponse({ status: 200, description: 'OAuth AS metadata' })
  getOAuthAuthorizationServer() {
    return this.buildAsMetadata();
  }

  @Get('openid-configuration')
  @ApiOperation({ summary: 'OpenID Connect Discovery 1.0 Configuration' })
  @ApiResponse({ status: 200, description: 'OIDC discovery document' })
  getOpenIdConfiguration() {
    const base = this.buildAsMetadata();
    const issuer = base.issuer;
    return {
      ...base,
      // OIDC additions
      userinfo_endpoint: `${issuer}/userinfo`,
      scopes_supported: ['openid', 'pid_credential'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256'],
      claims_supported: [
        'sub', 'iss', 'iat', 'exp',
        'given_name', 'family_name', 'birth_date', 'nationality',
      ],
    };
  }

  // ... existing endpoints below (unchanged)
```

**Step 3: Ensure `ConfigService` is available (it is — `ConfigModule.isGlobal` is true)**

The `AppModule` imports `ConfigModule.forRoot({ isGlobal: true })`. Adding `ConfigService`
to the constructor is sufficient — no module changes needed.

**Step 4: Build**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build api-gateway 2>&1 | tail -3
```

Must show `compiled successfully`.

**Step 5: Manual test after deploy**

```bash
curl -s https://wallet.eguilde.cloud/.well-known/oauth-authorization-server | python3 -m json.tool | head -15
curl -s https://wallet.eguilde.cloud/.well-known/openid-configuration | python3 -m json.tool | head -15
```

Both must return HTTP 200 with `"issuer": "https://wallet.eguilde.cloud"`.

**Step 6: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/api-gateway/src/controllers/well-known.controller.ts
git commit -m "feat(api-gateway): add RFC 8414 and OIDC discovery at standard .well-known paths

/.well-known/oauth-authorization-server and /.well-known/openid-configuration
were returning 404. Added both endpoints to WellKnownController.
Required by RFC 8414 and OpenID Connect Discovery 1.0 for relying party
federation and EUDI wallet client configuration.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Enhanced Health Endpoint with Dependency Checks

**Root cause:** The audit tested `/api/health` (returns 404 because `health` is excluded
from the `/api` prefix — correct path is `/health`). Additionally, the existing health
endpoint only returns a static `{ status: 'ok' }` with no dependency checks — useless for
detecting degraded state in Kubernetes or Docker Compose.

**Fix:**
1. Add DB connectivity check via `PgService`
2. Ping at least one downstream microservice via messaging to verify the bus is alive
3. Return structured `{ status: 'healthy'|'degraded'|'unhealthy', checks: {...} }`

**Files:**
- Modify: `monoback/apps/api-gateway/src/controllers/health.controller.ts`
- The controller is registered in `monoback/apps/api-gateway/src/app.module.ts` — check it
  imports `PgModule` and `MessagingModule` (they almost certainly do — verify before modifying)

**Step 1: Verify PgService and MessagingService are injectable in the controller**

```bash
grep -n "PgModule\|MessagingModule" /c/dev/eguilde_wallet/monoback/apps/api-gateway/src/app.module.ts | head -10
```

Expected output shows both modules imported. If not, add them.

**Step 2: Rewrite `health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PgService } from '@app/database';
import { MessagingService } from '@app/messaging';
import { Public } from '../decorators/public.decorator';

@Controller('health')
@ApiTags('health')
@Public()
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    private readonly pg: PgService,
    private readonly messaging: MessagingService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Full dependency health check' })
  async healthCheck() {
    const checks: Record<string, { status: string; responseTimeMs?: number; error?: string }> = {};
    let overall: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Database check
    const dbStart = Date.now();
    try {
      await this.pg.query('SELECT 1', []);
      checks['database'] = { status: 'ok', responseTimeMs: Date.now() - dbStart };
    } catch (err) {
      checks['database'] = { status: 'error', error: err.message };
      overall = 'unhealthy';
    }

    // DGEP service check via messaging
    const dgepStart = Date.now();
    try {
      const r = await Promise.race([
        this.messaging.request('svc.dgep', 'get_openid_metadata', {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]) as any;
      checks['dgep'] = {
        status: r?.success ? 'ok' : 'error',
        responseTimeMs: Date.now() - dgepStart,
      };
      if (!r?.success) overall = overall === 'healthy' ? 'degraded' : overall;
    } catch (err) {
      checks['dgep'] = { status: 'error', error: err.message };
      overall = overall === 'healthy' ? 'degraded' : overall;
    }

    // LOTL service check via messaging
    const lotlStart = Date.now();
    try {
      const r = await Promise.race([
        this.messaging.request('svc.lotl', 'get_trusted_services', {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]) as any;
      checks['lotl'] = {
        status: r?.success ? 'ok' : 'error',
        responseTimeMs: Date.now() - lotlStart,
      };
      if (!r?.success) overall = overall === 'healthy' ? 'degraded' : overall;
    } catch (err) {
      checks['lotl'] = { status: 'error', error: err.message };
      overall = overall === 'healthy' ? 'degraded' : overall;
    }

    return {
      status: overall,
      service: 'api-gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      checks,
    };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe — checks DB only' })
  async readiness() {
    try {
      await this.pg.query('SELECT 1', []);
      return { status: 'ready', service: 'api-gateway' };
    } catch (err) {
      // Return 503 if DB is down
      throw new (await import('@nestjs/common').then(m => m.ServiceUnavailableException))(
        'Database unavailable',
      );
    }
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — process alive check' })
  liveness() {
    return { status: 'alive', service: 'api-gateway' };
  }
}
```

Note: `liveness` must never hit the DB — if the process is alive it should return 200 always.
Only `readiness` and the full `healthCheck` hit dependencies.

**Step 3: Build**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build api-gateway 2>&1 | tail -3
```

**Step 4: Test locally / after deploy**

```bash
curl -s https://wallet.eguilde.cloud/health | python3 -m json.tool
curl -s https://wallet.eguilde.cloud/health/ready
curl -s https://wallet.eguilde.cloud/health/live
```

Full health must return `"status": "healthy"` when all services are up.

**Step 5: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/api-gateway/src/controllers/health.controller.ts
git commit -m "feat(api-gateway): enhance health endpoint with DB and service dependency checks

Added PgService and MessagingService checks to /health. Returns structured
{status, checks, uptimeSeconds} response. /health/ready checks DB and throws
503 if unavailable. /health/live always returns 200 (process-alive only).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: LOTL Self-Registration of National Services

**Root cause:** `verify-issuer?issuerUrl=wallet.eguilde.cloud` returns `trusted: false`
because the wallet and DGEP are not registered in the LOTL trusted services list.
`ServiceBootstrapService.onModuleInit()` only generates mTLS credentials — it never calls
`registerService()`.

**Fix:** Inject `TrustedServiceService` into `ServiceBootstrapService` and call
`selfRegisterNationalServices()` after credential initialisation. Register:
1. **DGEP** as `PID_PROVIDER` at `https://wallet.eguilde.cloud`
2. **Wallet Provider** as `EUDI_WALLET_PROVIDER` at `https://wallet.eguilde.cloud`

The registration is idempotent — if the service is already registered, the call is a no-op
(the `registerService` method already handles the "already exists" case).

**Files:**
- Modify: `monoback/apps/lotl/src/services/service-bootstrap.service.ts`
- Verify the LOTL module already has `TrustedServiceService` in providers (it does, per `lotl.module.ts`)

**Step 1: Read `trusted-service.service.ts` to understand `registerService` signature**

```bash
grep -n "async registerService" /c/dev/eguilde_wallet/monoback/apps/lotl/src/services/trusted-service.service.ts
```

The method signature (from explorer research):
```typescript
async registerService(dto: {
  serviceId: string;
  serviceName: string;
  serviceType: string;       // e.g. 'PID_PROVIDER', 'EUDI_WALLET_PROVIDER'
  tspName: string;
  tspTradeName?: string;
  tspAddress?: object;
  tspElectronicAddress?: object;
  serviceDigitalIdentity?: object;
  endpoints?: object;
  capabilities?: string[];
  metadata?: object;
  certificate?: string;
  certificateChain?: string[];
}): Promise<{ success: boolean; data?: any; error?: string }>
```

**Step 2: Modify `service-bootstrap.service.ts`**

Add `TrustedServiceService` injection and call `selfRegisterNationalServices()` at the end of
`initialize()`.

Full updated file:

```typescript
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';
import * as crypto from 'crypto';
import { QtspClientService } from './qtsp-client.service';
import { TrustedServiceService } from './trusted-service.service';
import { ServiceCredentialsRow } from '../interfaces';

@Injectable()
export class ServiceBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(ServiceBootstrapService.name);
  private credentials: ServiceCredentialsRow | null = null;

  constructor(
    private readonly pg: PgService,
    private qtspClient: QtspClientService,
    private configService: ConfigService,
    private readonly trustedServiceService: TrustedServiceService,
  ) {}

  async onModuleInit() {
    await this.initialize();
  }

  private async initialize() {
    try {
      const existing = await this.pg.queryOne<ServiceCredentialsRow>(
        `SELECT * FROM lotl_service_credentials
         WHERE registered = true
         ORDER BY created_at DESC
         LIMIT 1`,
        [],
      );

      if (existing && existing.certificate) {
        this.credentials = existing;
        this.logger.log('Service credentials loaded');
      } else {
        // ... (existing key generation + QTSP call code — do not modify)
        // keep all existing code here unchanged
      }
    } catch (error) {
      this.logger.error(`Credential generation failed: ${error.message}`);
      await this.generateFallbackCredentials();
    }

    // After credentials are loaded/generated, register national services
    await this.selfRegisterNationalServices();
  }

  /**
   * Register DGEP (PID_PROVIDER) and Wallet Provider (EUDI_WALLET_PROVIDER)
   * in this LOTL instance. Idempotent — safe to call on every startup.
   */
  private async selfRegisterNationalServices(): Promise<void> {
    const baseUrl = (
      this.configService.get<string>('WALLET_GATEWAY_URL') || 'https://wallet.eguilde.cloud'
    ).replace(/\/$/, '');

    const country = this.configService.get<string>('service.country') || 'RO';
    const orgName = this.configService.get<string>('service.name') || 'Romanian EUDI Wallet Scheme Operator';

    const services = [
      {
        serviceId: `${baseUrl}/dgep`,
        serviceName: 'Romanian PID Provider (DGEP)',
        serviceType: 'PID_PROVIDER',
        tspName: orgName,
        tspTradeName: 'DGEP Romania',
        tspAddress: {
          streetAddress: 'Bd. Libertății 14',
          locality: 'Bucharest',
          postalCode: '040129',
          countryName: country,
        },
        tspElectronicAddress: { uri: baseUrl },
        endpoints: {
          metadata: `${baseUrl}/.well-known/openid-credential-issuer`,
          credential: `${baseUrl}/credential`,
          token: `${baseUrl}/token`,
          jwks: `${baseUrl}/.well-known/pid-provider/jwks.json`,
        },
        capabilities: ['eu.europa.ec.eudi.pid.1'],
        metadata: {
          namespace: 'eu.europa.ec.eudi.pid.1',
          formats: ['dc+sd-jwt', 'mso_mdoc'],
          loaLevel: 'high',
        },
      },
      {
        serviceId: `${baseUrl}/wallet-provider`,
        serviceName: 'Romanian EUDI Wallet Provider',
        serviceType: 'EUDI_WALLET_PROVIDER',
        tspName: orgName,
        tspTradeName: 'eGuilde Wallet',
        tspAddress: {
          streetAddress: 'Bd. Libertății 14',
          locality: 'Bucharest',
          postalCode: '040129',
          countryName: country,
        },
        tspElectronicAddress: { uri: baseUrl },
        endpoints: {
          metadata: `${baseUrl}/.well-known/wallet-provider/openid-credential-issuer`,
          jwks: `${baseUrl}/.well-known/wallet-provider/jwks`,
          attestation: `${baseUrl}/api/attestation`,
        },
        capabilities: ['wallet_attestation', 'pid_storage', 'qeaa_storage'],
        metadata: {
          walletProviderId: 'urn:eidas:wallet:provider:ro:eguilde',
          certificationLevel: 'high',
        },
      },
    ];

    for (const svc of services) {
      try {
        const result = await this.trustedServiceService.registerService(svc);
        if (result.success) {
          this.logger.log(`Self-registered: ${svc.serviceName} (${svc.serviceId})`);
        } else {
          this.logger.warn(`Self-registration skipped for ${svc.serviceId}: ${result.error || 'already registered'}`);
        }
      } catch (err) {
        this.logger.error(`Self-registration failed for ${svc.serviceId}: ${err.message}`);
        // Non-fatal — the service starts regardless of registration status
      }
    }
  }

  // ... existing methods unchanged (generateFallbackCredentials, getPrivateKey, etc.)
```

**Important:** The `initialize()` method body must NOT be rewritten — only the two additions:
1. Inject `TrustedServiceService` in the constructor
2. Call `await this.selfRegisterNationalServices()` at the END of `initialize()`

**Step 3: Build**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build lotl 2>&1 | tail -3
```

**Step 4: Test after deploy**

```bash
# Should now return trusted: true for the wallet's own URL
curl -s "https://wallet.eguilde.cloud/api/lotl/verify-issuer?issuerUrl=https://wallet.eguilde.cloud" | python3 -m json.tool

# Should list DGEP and Wallet Provider
curl -s "https://wallet.eguilde.cloud/api/lotl/services" | python3 -c "
import sys, json
d = json.load(sys.stdin)
svcs = d.get('data', d) if isinstance(d, dict) else d
if isinstance(svcs, list):
    for s in svcs[:5]:
        print(s.get('service_id'), '-', s.get('service_name'), '-', s.get('status_code'))
"
```

Expected:
```
https://wallet.eguilde.cloud/dgep - Romanian PID Provider (DGEP) - granted
https://wallet.eguilde.cloud/wallet-provider - Romanian EUDI Wallet Provider - granted
```

**Step 5: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/lotl/src/services/service-bootstrap.service.ts
git commit -m "feat(lotl): self-register DGEP and Wallet Provider as trusted services on startup

wallet.eguilde.cloud was not listed in its own LOTL, causing verify-issuer
to return trusted:false. ServiceBootstrapService now calls registerService()
for PID_PROVIDER (DGEP) and EUDI_WALLET_PROVIDER on every startup.
Registration is idempotent — safe to call repeatedly.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Final Verification

After all four tasks are deployed, run this audit:

```bash
echo "=== POST-FIX AUDIT ===" && \

echo "1. Token RFC 6749 error shape" && \
TERR=$(curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=BAD") && \
echo "$TERR" | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS' if 'error' in d and 'error_description' in d and 'statusCode' not in d else 'FAIL', d)" && \

echo "2a. /.well-known/oauth-authorization-server" && \
curl -s https://wallet.eguilde.cloud/.well-known/oauth-authorization-server | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS issuer=' + d.get('issuer','MISSING') if d.get('issuer') else 'FAIL')" && \

echo "2b. /.well-known/openid-configuration" && \
curl -s https://wallet.eguilde.cloud/.well-known/openid-configuration | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS issuer=' + d.get('issuer','MISSING') if d.get('issuer') else 'FAIL')" && \

echo "3. Health endpoint" && \
curl -s https://wallet.eguilde.cloud/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS status=' + d.get('status','MISSING') if d.get('status') else 'FAIL')" && \

echo "4. LOTL self-registration" && \
curl -s "https://wallet.eguilde.cloud/api/lotl/verify-issuer?issuerUrl=https://wallet.eguilde.cloud" | python3 -c "import sys,json; d=json.load(sys.stdin); t=d.get('data',{}).get('trusted',False); print('PASS trusted=true' if t else 'FAIL trusted=false')"
```

All four should print `PASS`.

---

## Push and Deploy

After all tasks, push both repos:

```bash
cd /c/dev/eguilde_wallet && git push origin main
```

GitHub Actions CI/CD will build and deploy automatically to `egucluster3.eguilde.cloud`.
Wait ~90 seconds after push before running the final audit.
