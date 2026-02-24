# eIDAS 2.0 Remaining Fixes — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 3 code issues and 1 configuration issue found by the second compliance audit so that `wallet.eguilde.cloud` reaches full eIDAS 2.0 compliance.

**Architecture:** All fixes are in `C:\dev\eguilde_wallet\monoback`.
Task 1 propagates HTTP status through the NATS messaging layer (same pattern as the earlier RFC 6749 token fix).
Task 2 is a one-line path correction.
Task 3 replaces `BadRequestException(string)` with `BadRequestException({error, error_description})`.
Task 4 adds missing QTSP config values and re-generates the CA hierarchy.

**Tech Stack:** NestJS 10, TypeScript, @peculiar/x509, PostgreSQL, NATS messaging.

---

## Audit Baseline

```
Before: 8 PASS / 3 FAIL / 4 WARN
```

| # | Issue | Severity |
|---|-------|----------|
| 1 | `POST /credential` returns HTTP 400 + NestJS body for missing/invalid token | FAIL |
| 2 | `jwks_uri` in `/.well-known/openid-credential-issuer` points to 404 path | WARN |
| 3 | Token error codes are `"Bad Request"` / `"Unauthorized"` instead of `"invalid_request"` / `"invalid_grant"` | WARN |
| 4 | QTSP CA chain certificates contain `C=undefined, O=undefined` | WARN |

Note: "Credential offer missing" and "c_nonce endpoint missing" are FALSE ALARMS — the offer endpoint exists at `/api/dgep/pid-issuer/credential-offers` and c_nonce is already returned in the token response.

---

## Task 1: Credential Endpoint Returns 401 + RFC 6749 Body for Auth Failures

**Root cause:**
`dgep.controller.ts requestCredential` catches all errors and always throws `HttpException(message, 400)`.
When the access token is invalid/missing, `credential-issuance.service.ts` throws `UnauthorizedException`, which comes back from the NATS messaging layer as `{ success: false, error: error.message }` (a string — no HTTP status preserved). The controller wraps it as HTTP 400.

RFC 6750 §3.1 requires HTTP **401** with `WWW-Authenticate: Bearer` and `{"error":"invalid_token","error_description":"..."}` body.

**Files:**
- Modify: `monoback/apps/dgep/src/controllers/messaging.controller.ts` (~line 172)
- Modify: `monoback/apps/api-gateway/src/controllers/dgep.controller.ts` (~line 177)

---

**Step 1: Read both files to confirm current state**

```bash
grep -n "openid_credential\|httpStatus\|HttpStatus\|UnauthorizedException\|BAD_REQUEST" \
  /c/dev/eguilde_wallet/monoback/apps/dgep/src/controllers/messaging.controller.ts | head -20
grep -n "requestCredential\|openid_credential\|BAD_REQUEST\|HttpStatus" \
  /c/dev/eguilde_wallet/monoback/apps/api-gateway/src/controllers/dgep.controller.ts | head -20
```

---

**Step 2: Update `messaging.controller.ts` — `openidCredential` handler**

Find the handler (currently ~lines 172–188):
```typescript
@MessageHandler('svc.dgep', 'openid_credential')
async openidCredential(data: any) {
  this.logger.log('Messaging: openid_credential called');
  const payload = data.payload || data;

  try {
    const result = await this.credentialIssuanceService.handleCredentialRequest(
      payload.accessToken,
      payload,
      payload.dpopProof,
    );
    return { success: true, data: result };
  } catch (error) {
    this.logger.error(`openid_credential failed: ${error.message}`);
    return { success: false, error: error.message };
  }
}
```

Replace the catch block with:
```typescript
  } catch (error) {
    this.logger.error(`openid_credential failed: ${error.message}`);
    const httpStatus: number = error?.status || 400;
    const oauthError =
      error?.response && typeof error.response === 'object' && error.response.error
        ? { error: error.response.error, error_description: error.response.error_description || error.message }
        : httpStatus === 401
          ? { error: 'invalid_token', error_description: error.message }
          : { error: 'invalid_request', error_description: error.message };
    return { success: false, httpStatus, oauthError };
  }
```

---

**Step 3: Update `dgep.controller.ts` — `requestCredential` method**

Find the method (currently ~lines 177–201). Replace the **entire method body**:

```typescript
@Public()
@Post('credential')
@HttpCode(HttpStatus.OK)
@ApiOperation({ summary: 'Request credential issuance' })
@ApiResponse({ status: 200, description: 'Credential issued' })
async requestCredential(
  @Body() data: any,
  @Headers('authorization') authorization?: string,
  @Headers('dpop') dpopProof?: string,
) {
  const accessToken = authorization?.replace(/^Bearer /, '').replace(/^DPoP /, '') || '';
  const result = await this.messaging.request('svc.dgep', 'openid_credential', {
    ...data,
    accessToken,
    dpopProof,
  });

  if (result && !result.success) {
    await this.audit.logFailure('openid_credential', 'api-gateway', 'dgep', result.oauthError?.error_description || result.error);
    const status: number = result.httpStatus ?? HttpStatus.BAD_REQUEST;
    const body = result.oauthError ?? {
      error: 'invalid_request',
      error_description: result.error || 'Credential issuance failed',
    };
    throw new HttpException(body, status);
  }

  await this.audit.logSuccess('openid_credential', 'api-gateway', 'dgep');
  return result?.data ?? result;
}
```

---

**Step 4: Build both apps**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build dgep 2>&1 | tail -3
bun nest build api-gateway 2>&1 | tail -3
```

Both must show `compiled successfully`.

---

**Step 5: Verify manually after deploy**

```bash
# Missing token → must be HTTP 401
HTTP=$(curl -s -o /tmp/cred_err.json -w "%{http_code}" -X POST https://wallet.eguilde.cloud/credential \
  -H "Content-Type: application/json" -d '{"format":"dc+sd-jwt"}')
echo "HTTP: $HTTP"   # expected: 401
cat /tmp/cred_err.json | python3 -m json.tool
# expected: {"error":"invalid_token","error_description":"..."} — no statusCode field
```

---

**Step 6: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/dgep/src/controllers/messaging.controller.ts \
        monoback/apps/api-gateway/src/controllers/dgep.controller.ts
git commit -m "$(cat <<'EOF'
fix(dgep): credential endpoint returns 401 for invalid/missing token

Per RFC 6750 §3.1, missing or invalid Bearer/DPoP tokens must return
HTTP 401 (not 400). Propagated HTTP status through messaging layer
alongside RFC 6749 {error,error_description} body.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Fix `jwks_uri` in OpenID Credential Issuer Metadata

**Root cause:**
`/.well-known/openid-credential-issuer` advertises `jwks_uri: ".../.well-known/jwks.json"` (returns 404).
The correct path that actually serves the JWKS is `/.well-known/pid-provider/jwks.json`.
This wrong URL appears at **two** places in `messaging.controller.ts` (lines 307 and 461).

**Files:**
- Modify: `monoback/apps/dgep/src/controllers/messaging.controller.ts` (lines ~307 and ~461)

---

**Step 1: Confirm both occurrences**

```bash
grep -n "jwks_uri\|jwks\.json" \
  /c/dev/eguilde_wallet/monoback/apps/dgep/src/controllers/messaging.controller.ts
```

Expected output includes two lines like:
```
307:          jwks_uri: `${issuerUrl}/.well-known/jwks.json`,
461:      jwks_uri: `${issuerUrl}/.well-known/jwks.json`,
```

---

**Step 2: Fix both occurrences**

Use global replace in `messaging.controller.ts` — change ALL occurrences of:
```
/.well-known/jwks.json
```
to:
```
/.well-known/pid-provider/jwks.json
```

This is a safe global replace since there are exactly two occurrences and both need the same fix.

---

**Step 3: Build**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build dgep 2>&1 | tail -3
```

Must show `compiled successfully`.

---

**Step 4: Verify after deploy**

```bash
curl -s https://wallet.eguilde.cloud/.well-known/openid-credential-issuer | python3 -c "
import sys, json
d = json.load(sys.stdin)
jwks = d.get('jwks_uri', 'MISSING')
print('jwks_uri:', jwks)
# Verify the URL actually works
import urllib.request
code = urllib.request.urlopen(jwks).getcode()
print('JWKS HTTP:', code)
"
```

Expected: `jwks_uri: https://wallet.eguilde.cloud/.well-known/pid-provider/jwks.json` and `JWKS HTTP: 200`.

---

**Step 5: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/dgep/src/controllers/messaging.controller.ts
git commit -m "$(cat <<'EOF'
fix(dgep): correct jwks_uri path in OpenID Credential Issuer metadata

/.well-known/jwks.json does not exist (404). The actual JWKS endpoint
is /.well-known/pid-provider/jwks.json. Fixed in both get_openid_metadata
(line ~307) and get_credential_issuer_metadata (line ~461).

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Fix RFC 6749 Error Codes in Token Service

**Root cause:**
`token.service.ts` throws `BadRequestException(string)`, which NestJS serialises with `error: "Bad Request"`.
Our messaging layer propagates `error.response.error` — so the token endpoint returns `{"error":"Bad Request","error_description":"..."}`.
RFC 6749 §5.2 defines exactly six valid error codes: `invalid_request`, `invalid_client`, `invalid_grant`, `unauthorized_client`, `unsupported_grant_type`, `invalid_scope`.

**Files:**
- Modify: `monoback/apps/dgep/src/services/token.service.ts` (~lines 62–75)

---

**Step 1: Read and confirm current error throws**

```bash
grep -n "BadRequestException\|UnauthorizedException\|throw new" \
  /c/dev/eguilde_wallet/monoback/apps/dgep/src/services/token.service.ts | head -20
```

Expected:
```
62:    throw new BadRequestException(`Unsupported grant_type: ...`);  ← string
69:    throw new BadRequestException('pre-authorized_code is required');  ← string
74:    throw new BadRequestException('tx_code is required');  ← string
```

Also check if `preAuthService.validate` or `dpopService.verifyDPoPProof` throw exceptions with string messages — they likely need fixing too.

---

**Step 2: Replace string-based throws with RFC 6749 error objects**

Find and replace each throw in `token.service.ts`:

**Replace 1** (unsupported grant type):
```typescript
// FROM:
throw new BadRequestException(
  `Unsupported grant_type: ${request.grant_type}`,
);
// TO:
throw new BadRequestException({
  error: 'unsupported_grant_type',
  error_description: `Unsupported grant_type: ${request.grant_type}`,
});
```

**Replace 2** (missing pre-authorized_code):
```typescript
// FROM:
throw new BadRequestException('pre-authorized_code is required');
// TO:
throw new BadRequestException({
  error: 'invalid_request',
  error_description: 'pre-authorized_code is required',
});
```

**Replace 3** (missing tx_code):
```typescript
// FROM:
throw new BadRequestException('tx_code is required');
// TO:
throw new BadRequestException({
  error: 'invalid_request',
  error_description: 'tx_code is required',
});
```

Also find any throw related to invalid/expired pre-auth code (from `preAuthService.validate`) and make sure that path returns `invalid_grant`:
```typescript
// If preAuthService throws a generic error, wrap it:
// In the catch block around preAuth validation, return:
throw new BadRequestException({
  error: 'invalid_grant',
  error_description: 'The pre-authorization code is invalid or expired',
});
```

Read the relevant lines of `token.service.ts` to find where `preAuthService.validate` throws and adapt accordingly.

---

**Step 3: Build**

```bash
cd /c/dev/eguilde_wallet/monoback
bun nest build dgep 2>&1 | tail -3
```

Must show `compiled successfully`.

---

**Step 4: Verify after deploy**

```bash
# Test 1: Missing tx_code
curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=TEST" | python3 -m json.tool
# Expected: {"error":"invalid_request","error_description":"tx_code is required"}

# Test 2: Invalid code (with tx_code present)
curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=INVALID&tx_code=000000" | python3 -m json.tool
# Expected: {"error":"invalid_grant","error_description":"..."}

# Test 3: Wrong grant_type
curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=TEST" | python3 -m json.tool
# Expected: {"error":"unsupported_grant_type","error_description":"..."}
```

All responses must have `error` as a registered RFC 6749 value, no `statusCode` or `message` fields.

---

**Step 5: Commit**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/dgep/src/services/token.service.ts
git commit -m "$(cat <<'EOF'
fix(dgep): use registered RFC 6749 error codes in token service

token.service.ts was throwing BadRequestException(string) which NestJS
converts to error:'Bad Request'. RFC 6749 §5.2 requires registered error
codes: invalid_request, invalid_grant, unsupported_grant_type.
Replaced all string throws with {error, error_description} objects.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Fix QTSP CA Chain `C=undefined, O=undefined`

**Root cause:**
`qtsp-ca.service.ts createCAHierarchy()` reads:
```typescript
const organization = this.configService.get<string>('qtsp.organization');
const countryCode = this.configService.get<string>('qtsp.countryCode');
```
If these config keys are not set, the values are `undefined` and the CA subject becomes `C=undefined, O=undefined, CN=undefined QTSP Root CA`.

The CA hierarchy is only created once (if no `ca_certificates` rows exist). On subsequent starts, the existing broken certs are loaded. The fix is to:
1. Set the correct config values
2. Delete the broken CA chain rows from the database
3. Restart the QTSP service so `createCAHierarchy()` runs again with correct values

**Warning:** Deleting the CA chain means existing signed certificates (leaf certs) will reference a new CA. In production this would invalidate existing certs. Since this is a pre-production national pilot, re-generation is acceptable.

**Files:**
- Check: `monoback/apps/qtsp/src/` — find where `qtsp.organization` and `qtsp.countryCode` are registered (look for `app.module.ts` or `config/*.ts`)
- Modify: `.env` file on the server OR NestJS config registration to add the missing values

---

**Step 1: Find where QTSP config is registered**

```bash
grep -rn "qtsp\." /c/dev/eguilde_wallet/monoback/apps/qtsp/src/ | grep -v ".spec." | head -20
grep -rn "qtsp\." /c/dev/eguilde_wallet/monoback/apps/qtsp/src/app.module.ts | head -20
# Also check if there's a config file:
ls /c/dev/eguilde_wallet/monoback/apps/qtsp/src/ | grep -i config
cat /c/dev/eguilde_wallet/monoback/apps/qtsp/src/app.module.ts | grep -A5 "ConfigModule\|forRoot"
```

---

**Step 2: Find the correct config key names and set them**

Based on the code in `qtsp-ca.service.ts`:
- `qtsp.organization` maps to something like `QTSP_ORGANIZATION` env var
- `qtsp.countryCode` maps to something like `QTSP_COUNTRY_CODE` env var

After identifying the actual env var names, SSH to the server and check the environment:
```bash
ssh eguilde@egucluster3.eguilde.cloud \
  "docker compose -f /home/eguilde/eguilde_wallet/docker-compose.yml exec qtsp env | grep -i qtsp | head -20"
```

---

**Step 3: Add missing env vars to `.env` on server**

If the values are missing, add them:
```bash
ssh eguilde@egucluster3.eguilde.cloud "cat >> /home/eguilde/eguilde_wallet/.env <<'EOF'
QTSP_ORGANIZATION=Romanian QTSP Authority
QTSP_COUNTRY_CODE=RO
EOF
"
```

(Adjust key names based on findings from Step 1/2.)

---

**Step 4: Also add to the repo's `.env.example` or config default**

In `qtsp-ca.service.ts`, add fallbacks so it never gets `undefined`:
```typescript
const organization = this.configService.get<string>('qtsp.organization') || 'Romanian QTSP Authority';
const countryCode = this.configService.get<string>('qtsp.countryCode') || 'RO';
```

This prevents silent `undefined` even if the env var is missing in future.

---

**Step 5: Delete the broken CA rows and restart QTSP**

```bash
ssh eguilde@egucluster3.eguilde.cloud \
  "docker compose -f /home/eguilde/eguilde_wallet/docker-compose.yml exec postgres \
   psql -U \$POSTGRES_USER -d \$POSTGRES_DB -c 'DELETE FROM ca_certificates;'"
```

Then restart QTSP so `initialize()` runs `createCAHierarchy()`:
```bash
ssh eguilde@egucluster3.eguilde.cloud \
  "docker compose -f /home/eguilde/eguilde_wallet/docker-compose.yml restart qtsp"
```

---

**Step 6: Verify CA chain is correct**

```bash
# Check the x5c chain in the JWKS
curl -s https://wallet.eguilde.cloud/.well-known/pid-provider/jwks.json | python3 -c "
import sys, json, base64, ssl, hashlib

d = json.load(sys.stdin)
key = d['keys'][0]
x5c = key.get('x5c', [])
print(f'Chain length: {len(x5c)}')
for i, cert_b64 in enumerate(x5c):
    der = base64.b64decode(cert_b64)
    # Parse subject — look for C= and O= in DER
    text = str(der)
    if 'undefined' in text.lower():
        print(f'  Cert {i}: STILL HAS undefined values')
    else:
        print(f'  Cert {i}: OK (no undefined values)')
"
```

Expected: All certs show OK.

---

**Step 7: Commit the code fallback fix**

```bash
cd /c/dev/eguilde_wallet
git add monoback/apps/qtsp/src/services/qtsp-ca.service.ts
git commit -m "$(cat <<'EOF'
fix(qtsp): add fallback defaults for organization and countryCode in CA hierarchy

If QTSP_ORGANIZATION or QTSP_COUNTRY_CODE are not set, the CA certificates
were generated with C=undefined, O=undefined. Added || fallbacks so the CA
hierarchy is always generated with valid values.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
git push origin main
```

---

## Final Verification

After all tasks are deployed:

```bash
echo "=== POST-FIX AUDIT ===" && \

echo "1. Credential endpoint 401" && \
HTTP=$(curl -s -o /tmp/ce.json -w "%{http_code}" -X POST https://wallet.eguilde.cloud/credential \
  -H "Content-Type: application/json" -d '{"format":"dc+sd-jwt"}') && \
python3 -c "import json; d=json.load(open('/tmp/ce.json')); print('PASS HTTP 401' if '$HTTP' == '401' and 'error' in d and 'statusCode' not in d else 'FAIL', d)" && \

echo "2. jwks_uri correct" && \
curl -s https://wallet.eguilde.cloud/.well-known/openid-credential-issuer | \
python3 -c "import sys,json; d=json.load(sys.stdin); u=d.get('jwks_uri',''); print('PASS' if 'pid-provider' in u else 'FAIL wrong path: ' + u)" && \

echo "3a. Token error code (missing tx_code)" && \
curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=TEST" | \
python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS error=' + d.get('error','MISSING') if d.get('error') in ['invalid_request','invalid_grant','unsupported_grant_type'] else 'FAIL error=' + d.get('error','MISSING'), d)" && \

echo "3b. Token error code (invalid code)" && \
curl -s -X POST https://wallet.eguilde.cloud/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=INVALID&tx_code=000000" | \
python3 -c "import sys,json; d=json.load(sys.stdin); print('PASS error=' + d.get('error','MISSING') if d.get('error') in ['invalid_request','invalid_grant','unsupported_grant_type'] else 'FAIL error=' + d.get('error','MISSING'), d)" && \

echo "4. QTSP CA chain" && \
curl -s https://wallet.eguilde.cloud/.well-known/pid-provider/jwks.json | \
python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
x5c=d['keys'][0].get('x5c',[])
ok=all('undefined' not in base64.b64decode(c).decode('latin-1','replace') for c in x5c)
print('PASS - no undefined in CA chain' if ok else 'FAIL - undefined still in chain')
"
```

All four should print `PASS`.

---

## Push and Deploy

```bash
cd /c/dev/eguilde_wallet && git push origin main
```

GitHub Actions CI/CD deploys automatically. Wait ~90 seconds before running the final audit.
