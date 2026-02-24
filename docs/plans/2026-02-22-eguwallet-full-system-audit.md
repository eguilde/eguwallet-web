# EguWallet Full System Audit & Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bring the entire eguwallet.eu stack to a fully functional, eIDAS 2.0 compliant system with working Angular frontends, correct Android integration, proper inter-service communication, and a verified E2E test suite.

**Architecture:** 6 NestJS microservices (wallet-provider, qtsp, lotl, certification, dgep, dgp) each with an embedded Angular frontend, deployed on egucluster3 behind nginx on egucluster1. Services communicate via PostgreSQL LISTEN/NOTIFY but are currently on separate databases, breaking cross-service calls. The Android app (`eguwallet-android`) still points to the old eguwallet.com domain.

**Tech Stack:** NestJS + Bun, Angular 17+, PostgreSQL, Docker/GHCR, GitHub Actions, Kotlin/Jetpack Compose (Android), eIDAS 2.0 ARF 2.5.0, OpenID4VCI, OpenID4VP, SD-JWT, mTLS.

---

## CRITICAL ROOT CAUSE: Cross-Service PG Messaging Broken

All 6 services use PG LISTEN/NOTIFY for inter-service calls (`svc.qtsp`, `svc.dgep`, etc.) but each connects to its own database (`eguwallet_qtsp`, `eguwallet_dgep`, etc.). PostgreSQL LISTEN/NOTIFY is scoped to a single database — so services cannot hear each other.

**Symptoms observed:**
- DGEP bootstrap: `Request timeout: svc.qtsp.issue_certificate after 10000ms` → falls back to self-signed cert
- wallet-provider: `operating without full registration` (can't reach certification service)

**Fix:** Add a `MESSAGING_DB_*` env var set to `eguwallet_messaging` (a shared DB) for all services, so MessagingModule connects to the shared DB while the service's data queries use its own DB.

---

## Task 1: Create Shared Messaging Database

**Repos:** Server-side only (egucluster3)
**Files:**
- SSH: create `eguwallet_messaging` PostgreSQL database
- Modify: `/home/eguilde/eguwallet-*/docker-compose.yml` (6 files on server)

**Step 1: Create shared messaging DB on egucluster3**
```bash
ssh eguilde@egucluster3.eguilde.cloud \
  "psql -U postgres -c 'CREATE DATABASE eguwallet_messaging;'"
```
Expected: `CREATE DATABASE`

**Step 2: Add MESSAGING_DB_* env vars to all 6 docker-compose.yml on server**

For each `/home/eguilde/eguwallet-{service}/docker-compose.yml`, add under `environment:`:
```yaml
      MESSAGING_DB_HOST: host-gateway
      MESSAGING_DB_PORT: "5432"
      MESSAGING_DB_USER: postgres
      MESSAGING_DB_PASSWORD: "qWx11??9"
      MESSAGING_DB_NAME: eguwallet_messaging
```

Run per service (e.g., wallet-provider):
```bash
ssh eguilde@egucluster3.eguilde.cloud "
cd /home/eguilde/eguwallet-wallet-provider
# Add messaging env vars before the 'extra_hosts:' line
sed -i '/extra_hosts:/i\      MESSAGING_DB_HOST: host-gateway\n      MESSAGING_DB_PORT: \"5432\"\n      MESSAGING_DB_USER: postgres\n      MESSAGING_DB_PASSWORD: \"qWx11??9\"\n      MESSAGING_DB_NAME: eguwallet_messaging' docker-compose.yml
"
```
Repeat for all 6 services.

**Step 3: Check if MessagingModule supports MESSAGING_DB_* config**

Read `/c/dev/eguwallet-wallet-provider/libs/messaging/src/messaging.module.ts` and look for how the DB connection is configured. If it uses `DB_HOST`/`DB_DATABASE`, update the module to prefer `MESSAGING_DB_*` when set.

**Step 4: Update MessagingModule (in wallet-provider — shared lib)**

In `libs/messaging/src/messaging.module.ts`, change database config to:
```typescript
database: configService.get('MESSAGING_DB_NAME') || configService.get('DB_DATABASE'),
host: configService.get('MESSAGING_DB_HOST') || configService.get('DB_HOST'),
// etc.
```
Commit and push — CI rebuilds all service images.

**Step 5: Restart all 6 containers on egucluster3**
```bash
ssh eguilde@egucluster3.eguilde.cloud "
for d in wallet-provider qtsp lotl certification dgep dgp; do
  cd /home/eguilde/eguwallet-\$d && docker compose up -d
done
"
```

**Step 6: Verify cross-service messaging works**
```bash
ssh eguilde@egucluster3.eguilde.cloud "docker logs eguwallet-dgep-dgep-1 --tail 20 2>&1 | grep -E 'PHASE|Bootstrap|certificate|ERROR'"
```
Expected: `PHASE 1`, `PHASE 2`, `PHASE 3`, `PHASE 4` — NOT `Request timeout`.

**Step 7: Commit**
```bash
# In eguwallet-wallet-provider:
git add libs/messaging/src/messaging.module.ts
git commit -m "fix(messaging): support MESSAGING_DB_* env for shared cross-service messaging DB"
git push origin main
```
Repeat identical commit in each of the other 5 repos (they share the same lib pattern).

---

## Task 2: Fix Android WalletConfig.kt — Domain + DeviceId

**Repo:** `/c/dev/eguwallet-android/`
**Files:**
- Modify: `app/src/main/java/com/eguwallet/wallet/config/WalletConfig.kt`
- Modify: `app/src/main/java/com/eguwallet/wallet/data/api/UserApiService.kt` (deviceId fix)
- Modify: `app/build.gradle.kts` (applicationId)

**Step 1: Update WalletConfig.kt domain references**

File: `app/src/main/java/com/eguwallet/wallet/config/WalletConfig.kt`

Change:
```kotlin
val walletProviderDid = "did:web:wallet.eguwallet.com"
val baseUrl = "https://wallet.eguwallet.com/api"
val qtspEndpoint: String? = "https://qtsp.eguwallet.com"
```
To:
```kotlin
val walletProviderDid = "did:web:wallet.eguwallet.eu"
val baseUrl = "https://wallet.eguwallet.eu/api"
val qtspEndpoint: String? = "https://qtsp.eguwallet.eu"
```

**Step 2: Update applicationId in build.gradle.kts**

File: `app/build.gradle.kts` line ~15:
```kotlin
applicationId = "eu.eguwallet.wallet"  // was "wallet.eguwallet.com"
```
Note: Keep `namespace = "com.eguwallet.wallet"` (code package) separate from applicationId.

**Step 3: Fix deviceId in UserApiService.kt**

In `app/src/main/java/com/eguwallet/wallet/data/api/UserApiService.kt`, lines 75 and 86 use `android.os.Build.ID`.

`Build.ID` is the OS build string (e.g., "UQ1A.240105.004") — it is NOT unique per device.

`Settings.Secure.ANDROID_ID` is unique per device+app+signing key.

The class needs a `Context` to call `Settings.Secure.getString()`. Check the constructor — if it already has `@ApplicationContext context: Context`, use it. If not, inject `@ApplicationContext context: Context` via Hilt.

Change lines 75, 86 from:
```kotlin
android.os.Build.ID
```
To:
```kotlin
android.provider.Settings.Secure.getString(context.contentResolver, android.provider.Settings.Secure.ANDROID_ID)
```

**Step 4: Build and verify**
```bash
cd /c/dev/eguwallet-android
./gradlew assembleDebug 2>&1 | tail -20
```
Expected: `BUILD SUCCESSFUL`

**Step 5: Commit and push**
```bash
git add app/src/main/java/com/eguwallet/wallet/config/WalletConfig.kt \
        app/src/main/java/com/eguwallet/wallet/data/api/UserApiService.kt \
        app/build.gradle.kts
git commit -m "fix(android): update domain to eguwallet.eu and fix deviceId to use ANDROID_ID"
git push origin main
```

---

## Task 3: Angular Frontend Audit Per Service

**Context:** Each service has a `frontend/` directory. The Dockerfile builds `npx ng build wallet` and embeds the output in the NestJS dist. Need to verify each frontend is complete and has:
- A public landing page describing the service's purpose
- A management/admin dashboard for the service
- Correct API base URL pointing to `eguwallet.eu`

**Step 1: Check frontend structure for each service**
```bash
for repo in wallet-provider qtsp lotl certification dgep dgp; do
  echo "=== eguwallet-$repo frontend ==="
  find /c/dev/eguwallet-$repo/frontend/src -name "*.ts" -o -name "*.html" | grep -E "app\.(ts|html|routes)" | head -5
  echo ""
done
```

**Step 2: Per service — verify angular.json project name matches Dockerfile**

In each `frontend/angular.json`, the project name in `projects:` must match `npx ng build <name>` in the Dockerfile.

E.g., wallet-provider Dockerfile: `npx ng build wallet` → check `frontend/angular.json` has `"wallet": { ... }`.

**Step 3: Verify each frontend builds locally**
```bash
cd /c/dev/eguwallet-wallet-provider/frontend
npm ci --legacy-peer-deps && npx ng build wallet --configuration production 2>&1 | tail -10
```
Expected: `✔ Building...` with no errors.

**Step 4: For each service — add/update public landing page**

Each service's Angular app should have a home route (`/`) showing:
- Service name and logo
- Brief description of what the service does (in Romanian and English)
- Status indicator (healthy/degraded)
- Links to admin sections

Example for wallet-provider `src/app/pages/home/home.component.html`:
```html
<div class="flex flex-col items-center justify-center min-h-screen p-8">
  <h1 class="text-4xl font-bold mb-4">EguWallet Provider</h1>
  <p class="text-lg text-center max-w-2xl mb-8">
    Furnizorul de portofele digitale eIDAS 2.0 pentru România.
    Emite atestări de instanță portofel (WIA) conforme cu ARF 2.5.0.
  </p>
  <p class="text-base text-center max-w-2xl opacity-70">
    eIDAS 2.0 digital wallet provider for Romania.
    Issues Wallet Instance Attestations (WIA) compliant with ARF 2.5.0.
  </p>
</div>
```

Commit per service with: `feat(frontend): add public landing page for wallet-provider`

**Step 5: Verify landing page renders at service URL**
```bash
curl -s https://wallet.eguwallet.eu/ | grep -o '<title>.*</title>'
```

---

## Task 4: eIDAS 2.0 Compliance Audit Per Service

### 4a: wallet-provider (ARF 2.5.0 compliance)

**Checklist:**
- [ ] `/.well-known/openid-credential-issuer` → returns correct metadata
- [ ] `/.well-known/wallet-provider` → returns WIA metadata
- [ ] Wallet Instance Registration: `POST /api/wallet/register`
- [ ] DPoP token binding on all wallet endpoints
- [ ] Key attestation: Play Integrity (Android) + Apple App Attest (iOS)
- [ ] WIA issuance with holder binding (cnf claim)
- [ ] Backup/restore wallet instance
- [ ] Proximity presentation (ISO 18013-5)

**Verify:**
```bash
# Well-known metadata
curl -s https://wallet.eguwallet.eu/.well-known/wallet-provider | python3 -m json.tool | head -30

# OpenID credential issuer
curl -s https://wallet.eguwallet.eu/.well-known/openid-credential-issuer | python3 -m json.tool | head -20
```
Expected: valid JSON with `credential_issuer`, `credential_endpoint`, `jwks_uri`.

### 4b: dgep (PID Issuer — eIDAS 2.0 §6.6.2)

**Checklist:**
- [ ] `/.well-known/openid-credential-issuer` → returns PID credential metadata
- [ ] Token endpoint: `POST /token` with `pre-authorized_code` grant
- [ ] Credential endpoint: `POST /credentials` with DPoP-bound access token
- [ ] Status list: `GET /credentials/status/:id` (RFC 9102)
- [ ] Batch issuance: `POST /credentials/batch`
- [ ] SD-JWT-VC format with correct `vct` claim
- [ ] PID claims: given_name, family_name, birthdate, age_over_18, cnp
- [ ] Issuer certificate from QTSP (currently using self-signed — MUST fix after Task 1)

**Verify:**
```bash
curl -s https://dgep.eguwallet.eu/.well-known/openid-credential-issuer | python3 -m json.tool | grep -E "credential_issuer|credential_endpoint|format|vct"
```

### 4c: qtsp (Qualified Trust Service Provider)

**Checklist:**
- [ ] Issues QWAC, QSeal, PID_PROVIDER certificates
- [ ] CRL distribution: `/crl/:serial`
- [ ] OCSP: `/ocsp`
- [ ] TSA: `/tsa`
- [ ] TSL (Trust Service List): `/tsl`
- [ ] Certificates signed by Root CA in LOTL

**Verify:**
```bash
curl -s -o /dev/null -w "%{http_code}" https://qtsp.eguwallet.eu/tsl
# Should be 200 with XML content
curl -s https://qtsp.eguwallet.eu/tsl | head -5
```

### 4d: lotl (List of Trusted Lists)

**Checklist:**
- [ ] EU-LOTL synchronization from `https://ec.europa.eu/tools/lotl/eu-lotl.xml`
- [ ] Local LOTL XML export at `/lotl.xml`
- [ ] Trust list entries include QTSP, dgep, dgp
- [ ] LOTL XML signed with QTSP QSeal certificate

**Verify:**
```bash
curl -s -o /dev/null -w "%{http_code}" https://lotl.eguwallet.eu/lotl.xml
```

### 4e: certification (Conformity Assessment Body)

**Checklist:**
- [ ] Issues certification tokens to wallet-provider
- [ ] Conformity Assessment Reports (CAR) for wallet instances
- [ ] Stage 1 + Stage 2 audit trail
- [ ] Non-conformity management

### 4f: dgp (Digital Government Passport)

**Checklist:**
- [ ] Passport credential issuance (similar flow to DGEP)
- [ ] Status list for passport credentials
- [ ] mTLS for sensitive endpoints

---

## Task 5: Fix GitHub Workflows — Add Health Checks

**Files:** `.github/workflows/deploy.yml` in each of the 6 repos

**Current issue:** Deploy job only does `docker compose up -d` with no verification that the new container is healthy.

**Step 1: Update deploy job in all 6 repos**

For each `deploy.yml`, change the deploy step to:
```yaml
  deploy:
    needs: build
    runs-on: self-hosted

    steps:
      - name: Pull and restart container
        run: |
          cd /home/eguilde/${{ github.event.repository.name }}
          echo ${{ secrets.GITHUB_TOKEN }} | docker login ghcr.io -u ${{ github.actor }} --password-stdin
          docker compose pull
          docker compose up -d

      - name: Wait for health check
        run: |
          cd /home/eguilde/${{ github.event.repository.name }}
          sleep 10
          docker compose ps
          # Check container is healthy
          CONTAINER=$(docker compose ps -q | head -1)
          STATUS=$(docker inspect --format='{{.State.Health.Status}}' $CONTAINER 2>/dev/null || echo "no-healthcheck")
          echo "Container health: $STATUS"
          if [ "$STATUS" = "unhealthy" ]; then
            echo "Container is unhealthy!"
            docker compose logs --tail=50
            exit 1
          fi
          echo "Deploy successful"
```

**Step 2: Commit to each repo**
```bash
cd /c/dev/eguwallet-wallet-provider
git add .github/workflows/deploy.yml
git commit -m "ci: add health check verification after deploy"
git push origin main
```
Repeat for all 6 repos.

---

## Task 6: E2E Test Suite — Public Interface Tests

**Create:** `/c/dev/eguwallet-wallet-provider/e2e/public-endpoints.test.ts`

These tests verify the live `eguwallet.eu` stack is functional.

**Step 1: Create test file**

```typescript
// e2e/public-endpoints.test.ts
// Run with: bun test e2e/public-endpoints.test.ts
// Requires: EGUWALLET_BASE=https://wallet.eguwallet.eu (default)

const BASE = {
  wallet: 'https://wallet.eguwallet.eu',
  qtsp: 'https://qtsp.eguwallet.eu',
  lotl: 'https://lotl.eguwallet.eu',
  cert: 'https://cert.eguwallet.eu',
  dgep: 'https://dgep.eguwallet.eu',
  dgp: 'https://dgp.eguwallet.eu',
};

describe('EguWallet Public Endpoints', () => {
  // 1. Well-known discovery
  for (const [name, base] of Object.entries(BASE)) {
    test(`${name}: OIDC discovery returns 200`, async () => {
      const res = await fetch(`${base}/.well-known/openid-configuration`);
      expect(res.ok).toBe(true);
    });
  }

  // 2. Wallet-provider specific
  test('wallet-provider: wallet-provider metadata', async () => {
    const res = await fetch(`${BASE.wallet}/.well-known/wallet-provider`);
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.credential_issuer).toContain('eguwallet.eu');
    expect(json.jwks_uri).toBeDefined();
  });

  test('wallet-provider: credential issuer metadata', async () => {
    const res = await fetch(`${BASE.wallet}/.well-known/openid-credential-issuer`);
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.credential_configurations_supported).toBeDefined();
  });

  // 3. DGEP PID issuer
  test('dgep: credential issuer metadata has PID config', async () => {
    const res = await fetch(`${BASE.dgep}/.well-known/openid-credential-issuer`);
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.credential_configurations_supported).toBeDefined();
  });

  test('dgep: status list endpoint accessible', async () => {
    const res = await fetch(`${BASE.dgep}/credentials/status/1`);
    // 200 (valid) or 404 (no such list) are both acceptable
    expect([200, 404]).toContain(res.status);
  });

  // 4. QTSP PKI endpoints
  test('qtsp: TSL trust service list accessible', async () => {
    const res = await fetch(`${BASE.qtsp}/tsl`);
    expect(res.ok).toBe(true);
  });

  // 5. LOTL
  test('lotl: trust list XML accessible', async () => {
    const res = await fetch(`${BASE.lotl}/lotl.xml`);
    expect(res.ok).toBe(true);
    const text = await res.text();
    expect(text).toContain('<?xml');
  });

  // 6. HTTPS / TLS certificate valid
  test('wallet: TLS certificate covers eguwallet.eu wildcard', async () => {
    const res = await fetch(`${BASE.wallet}/.well-known/openid-configuration`);
    // If TLS was invalid, fetch would throw
    expect(res.ok).toBe(true);
  });

  // 7. Verification endpoint (phone/email OTP)
  test('wallet: verification send-code rejects missing fields', async () => {
    const res = await fetch(`${BASE.wallet}/api/verification/phone/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```

**Step 2: Run tests**
```bash
cd /c/dev/eguwallet-wallet-provider
bun test e2e/public-endpoints.test.ts --timeout 30000
```
Expected: all tests pass (except OIDC discovery for DGEP until Task 4 is done).

**Step 3: Commit**
```bash
git add e2e/public-endpoints.test.ts
git commit -m "test(e2e): add public endpoint smoke tests for eguwallet.eu stack"
git push origin main
```

---

## Task 7: E2E Test — Full Registration Flow (Android Simulation)

**Create:** `/c/dev/eguwallet-wallet-provider/e2e/registration-flow.test.ts`

Simulates what the Android app does during registration.

**Step 1: Create test**

```typescript
// e2e/registration-flow.test.ts
const BASE = 'https://wallet.eguwallet.eu';
const DEVICE_ID = `e2e-test-${Date.now()}`;
const TEST_PHONE = '+40700000000'; // Use a test number

describe('Wallet Registration Flow', () => {
  // Step 1: Phone verification
  test('send phone verification code', async () => {
    const res = await fetch(`${BASE}/api/verification/phone/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DEVICE_ID, phoneNumber: TEST_PHONE }),
    });
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // Step 2: Email verification
  test('send email verification code', async () => {
    const res = await fetch(`${BASE}/api/verification/email/send-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DEVICE_ID, email: 'e2e-test@eguwallet.eu' }),
    });
    expect(res.ok).toBe(true);
    const json = await res.json();
    expect(json.success).toBe(true);
  });

  // Step 3: Wallet nonce request
  test('wallet nonce endpoint accessible', async () => {
    const res = await fetch(`${BASE}/api/wallet/attestations/nonces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: DEVICE_ID }),
    });
    // 200 with nonce or 401 if auth required
    expect([200, 401, 403]).toContain(res.status);
  });
});
```

**Step 2: Run**
```bash
bun test e2e/registration-flow.test.ts --timeout 30000
```

**Step 3: Commit**
```bash
git add e2e/registration-flow.test.ts
git commit -m "test(e2e): add wallet registration flow smoke test"
git push origin main
```

---

## Task 8: E2E Test — PID Issuance Flow (DGEP)

**Create:** `/c/dev/eguwallet-dgep/e2e/pid-issuance.test.ts`

Tests the PID credential issuance flow per OpenID4VCI.

**Step 1: Create test**
```typescript
// e2e/pid-issuance.test.ts
const DGEP = 'https://dgep.eguwallet.eu';

describe('DGEP PID Issuance (OpenID4VCI)', () => {
  test('credential issuer metadata is valid', async () => {
    const res = await fetch(`${DGEP}/.well-known/openid-credential-issuer`);
    expect(res.ok).toBe(true);
    const meta = await res.json();
    expect(meta.credential_issuer).toContain('dgep.eguwallet.eu');
    expect(meta.credential_endpoint).toBeDefined();
    expect(meta.token_endpoint).toBeDefined();
    // Must have PID credential configuration
    expect(meta.credential_configurations_supported).toBeDefined();
    const configs = Object.values(meta.credential_configurations_supported) as any[];
    const pidConfig = configs.find(c => c.format === 'dc+sd-jwt' || c.vct?.includes('PID'));
    expect(pidConfig).toBeDefined();
  });

  test('token endpoint rejects invalid grant', async () => {
    const res = await fetch(`${DGEP}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=urn:ietf:params:oauth:grant-type:pre-authorized_code&pre-authorized_code=invalid',
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });

  test('credential endpoint requires authorization', async () => {
    const res = await fetch(`${DGEP}/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: 'dc+sd-jwt', credential_identifier: 'PID' }),
    });
    expect(res.status).toBe(401);
  });
});
```

**Step 2: Run**
```bash
cd /c/dev/eguwallet-dgep
bun test e2e/pid-issuance.test.ts --timeout 30000
```

**Step 3: Commit**
```bash
git add e2e/pid-issuance.test.ts
git commit -m "test(e2e): add DGEP PID issuance OpenID4VCI smoke test"
git push origin main
```

---

## Task 9: mTLS Verification Test

**Context:** Some endpoints (QTSP certificate issuance, compliance reporting) require mTLS. Haraka mTLS certs are at `/opt/eguilde/haraka-certs/` on egucluster3.

**Step 1: Check which endpoints require mTLS**
```bash
ssh eguilde@egucluster3.eguilde.cloud "
  docker exec eguwallet-qtsp-qtsp-1 env | grep -i mtls
  docker logs eguwallet-qtsp-qtsp-1 --tail 20 2>&1 | grep -i mtls
"
```

**Step 2: Test mTLS endpoint with client cert**
```bash
# Test QTSP certificate issuance endpoint (if mTLS protected)
curl -v --cert /path/to/client.crt --key /path/to/client.key \
  https://qtsp.eguwallet.eu/api/certificates/issue 2>&1 | grep -E "HTTP|SSL|certificate"
```

**Step 3: Document which endpoints use mTLS vs token auth**

---

## Task 10: Android App — Full Registration Flow Verification

**Repo:** `/c/dev/eguwallet-android/`

**Step 1: Trace the full registration flow in the Android code**
```bash
grep -rn "registration\|register\|sendPhone\|sendEmail\|walletRegister" \
  /c/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ \
  --include="*.kt" | grep -v "test\|Test" | head -30
```

**Step 2: Read the registration entry point**
```bash
cat /c/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/data/api/RegistrationSessionService.kt 2>/dev/null | head -60
```

**Step 3: Verify all API endpoints in WalletConfig match wallet-provider controllers**

Cross-check each `WalletConfig.kt` URL against the actual `wallet.controller.ts` and `user.controller.ts` routes. For example:
- `$baseUrl/wallet/register` → should match `@MessageHandler('svc.wallet', 'register_wallet_instance')` (via messaging bridge)
- `$baseUrl/wallet/attestations/nonces` → check if HTTP endpoint exists
- `$baseUrl/api/verification/phone/send-code` → ✓ added in Task 2 of previous session

**Step 4: Update WalletConfig PID issuer URL**

Current: `val pidIssuerUrl = "$baseUrl/credentials/issue/pid/"`

This points to wallet-provider but PID issuance is on DGEP. Update:
```kotlin
val pidIssuerUrl = "https://dgep.eguwallet.eu/api/pid/request"
val dgepBaseUrl = "https://dgep.eguwallet.eu"
```

**Step 5: Build release APK**
```bash
cd /c/dev/eguwallet-android
./gradlew assembleRelease 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL` with APK at `app/build/outputs/apk/release/app-release.apk`

**Step 6: Commit**
```bash
git add app/src/main/java/com/eguwallet/wallet/config/WalletConfig.kt
git commit -m "fix(android): point pidIssuerUrl to dgep.eguwallet.eu, fix all domain references"
git push origin main
```

---

## Execution Order (Dependencies)

```
Task 1 (messaging fix) → Task 4 (eIDAS compliance) depends on inter-service communication
Task 2 (Android domain) → Task 10 (Android flow) depends on correct URLs
Task 1 → Task 8 (DGEP E2E) requires DGEP to have proper QTSP cert
Task 3 (frontends) → independent
Task 5 (CI/CD) → independent
Task 6 (E2E public) → can run now, some tests will fail until Task 1+4 done
```

**Recommended execution order:**
1 → 2 → 5 → 6 → 3 → 4 → 7 → 8 → 9 → 10

---

## Quick Status Summary (as of 2026-02-22)

| Component | Status | Issue |
|-----------|--------|-------|
| wallet-provider HTTP | ✅ Up | Verification endpoints added |
| wallet-provider PG messaging | ⚠️ Degraded | Can't reach certification service |
| QTSP | ✅ Up | TSL serving correctly |
| LOTL | ✅ Up | |
| Certification | ✅ Up | |
| DGEP | ⚠️ Degraded | Self-signed cert (QTSP unreachable via messaging) |
| DGP | ✅ Up | |
| nginx eguwallet.eu | ✅ Active | Wildcard cert valid until May 2026 |
| nginx eguwallet.com | ❌ Removed | As requested |
| Android WalletConfig | ❌ Wrong domain | Still pointing to eguwallet.com |
| Android deviceId | ❌ Bug | Using Build.ID instead of ANDROID_ID |
| Angular frontends | ⚠️ Unknown | Need to verify content |
| Cross-service messaging | ❌ Broken | Different DB per service |
| eIDAS 2.0 PID cert chain | ⚠️ Partial | DGEP has self-signed, not QTSP-backed |
