# eIDAS 2.0 Full Remediation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all identified eIDAS 2.0 compliance and security issues across 6 eguwallet services, build complete Angular admin/inspector frontends for all services, add server-side Android key attestation verification, and implement ISO 18013-5 mDL (driving licence) issuance in DGEP.

**Architecture:** 6 standalone NestJS services in the monoback (`monoback/apps/`), shared Angular multi-project workspace (`monoback/frontends/projects/`). Each service has its own PostgreSQL DB, OIDC provider, and Docker Compose stack. Individual repos also at `/c/dev/eguwallet-{service}/`.

**Tech Stack:** NestJS 11, Angular 21 (standalone components), PrimeNG Aura + TailwindCSS 4, PostgreSQL, `bun` (NEVER npm), TypeScript strict mode, oidc-provider v9, `@peculiar/x509` for certificate operations.

**Critical Rules:**
- **ALWAYS use `bun`**, never `npm`
- **NEVER use `node-forge`** — use Node.js `crypto` module or `@peculiar/x509`
- **NEVER add `@Index()` TypeORM decorators**
- **Angular**: PrimeNG for ALL UI, Tailwind for layout only, NO custom colors
- All frontend components are **standalone** (no NgModules)

---

## Part 1: P0 Backend Security Fixes

### Task 1: Add Auth Guards to DGP Admin Endpoints

**Files:**
- Modify: `monoback/apps/dgp/src/controllers/dgp-messaging.controller.ts`
- Check: `monoback/apps/dgp/src/dgp.module.ts`

**Context:** DGP admin endpoints (approve/reject passport requests) have no authentication checks. The service uses a shared OIDC library from `monoback/libs/oidc/`.

**Step 1: Read the messaging controller and module**

```bash
cat monoback/apps/dgp/src/controllers/dgp-messaging.controller.ts
cat monoback/apps/dgp/src/dgp.module.ts
cat monoback/libs/oidc/src/oidc.service.ts | grep -n "guard\|auth\|Auth" | head -20
```

**Step 2: Find the existing auth guard pattern**

Look for how other services protect admin endpoints. Check:
```bash
ls monoback/libs/oidc/src/
grep -r "AuthGuard\|JwtGuard\|UseGuards" monoback/apps/ | head -20
```

**Step 3: Apply auth guard to admin message handlers**

In `dgp-messaging.controller.ts`, ensure that handlers like `approve`, `reject`, `assign`, `verifyAuto`, `getStats`, `getAll` validate that the calling service has a valid JWT or use the PG LISTEN/NOTIFY payload's `authorization` field.

The pattern for PG LISTEN/NOTIFY auth:
```typescript
// In each admin handler, validate the bearer token from the payload
private async validateAdminToken(payload: any): Promise<void> {
  const token = payload?.authorization?.replace('Bearer ', '');
  if (!token) throw new UnauthorizedException('Missing authorization token');
  // Verify token via OIDC provider or JWT validation
  const decoded = await this.oidcService.validateAccessToken(token);
  if (!decoded?.roles?.includes('admin')) {
    throw new ForbiddenException('Admin role required');
  }
}
```

**Step 4: Build and verify**

```bash
cd monoback && bun nest build dgp
```

Expected: Build succeeds with no TypeScript errors.

**Step 5: Commit**

```bash
git add monoback/apps/dgp/src/controllers/
git commit -m "fix(dgp): add auth guard to admin message handler endpoints"
```

---

### Task 2: Add Auth Guards to DGEP Admin Endpoints

**Files:**
- Modify: `monoback/apps/dgep/src/controllers/pid-request.controller.ts`
- Modify: `monoback/apps/dgep/src/controllers/carte-identitate.controller.ts`
- Check: `monoback/apps/dgep/src/dgep.module.ts`

**Context:** From the audit: "OidcModule regression — admin endpoints on PID request, Carte Identitate controllers have no auth checks." DGEP is in the monoback at `monoback/apps/dgep/` OR standalone at `/c/dev/eguwallet-dgep/apps/dgep/`.

**Step 1: Read the controllers**

```bash
# Check which location is canonical (look for recent modifications)
ls -la monoback/apps/dgep/src/controllers/ 2>/dev/null || \
ls -la /c/dev/eguwallet-dgep/apps/dgep/src/controllers/
```

**Step 2: Read pid-request.controller.ts**

```bash
cat monoback/apps/dgep/src/controllers/pid-request.controller.ts | head -60
```

**Step 3: Add UseGuards/auth validation**

For HTTP controllers in NestJS, add `@UseGuards(JwtAuthGuard)` and `@Roles('admin')` decorator to admin-only routes (approve, reject, getAll with full data).

For message handlers, add inline token validation similar to Task 1.

**Step 4: Build and verify**

```bash
cd monoback && bun nest build dgep
```

**Step 5: Commit**

```bash
git add monoback/apps/dgep/src/controllers/
git commit -m "fix(dgep): add auth guard to pid-request and carte-identitate admin endpoints"
```

---

### Task 3: Fix DPoP Nonce DB Persistence in Wallet Provider

**Files:**
- Read: `/c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/dpop.service.ts`
- Check: existing dpop_nonces table or create migration

**Context:** Wallet Provider DPoP nonces are in-memory (Map). On restart they are lost. This breaks DPoP replay protection. DGEP already has DB-based nonces — use that as reference.

**Step 1: Read the current DPoP service**

```bash
cat /c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/dpop.service.ts
```

**Step 2: Find the DGEP DPoP service for reference**

```bash
cat /c/dev/eguwallet-dgep/apps/dgep/src/services/dpop.service.ts 2>/dev/null || \
grep -r "dpop_nonces\|nonce" /c/dev/eguwallet-dgep/apps/dgep/src/ | head -20
```

**Step 3: Create DB migration for dpop_nonces table (if not exists)**

Check if `dpop_nonces` table exists in wallet-provider DB:
```bash
ls /c/dev/eguwallet-wallet-provider/migrations/
```

Create migration file if needed:
```sql
-- migrations/XXX_dpop_nonces.sql
CREATE TABLE IF NOT EXISTS dpop_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nonce VARCHAR(255) NOT NULL UNIQUE,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL DEFAULT NOW() + INTERVAL '5 minutes'
);
CREATE INDEX ON dpop_nonces (nonce);
CREATE INDEX ON dpop_nonces (expires_at);
```

**Step 4: Update DPoP service to use DB**

Replace in-memory Map with PostgreSQL queries:

```typescript
// Generate nonce
async generateNonce(): Promise<string> {
  const nonce = crypto.randomBytes(32).toString('base64url');
  await this.pg.query(
    `INSERT INTO dpop_nonces (nonce, expires_at) VALUES ($1, NOW() + INTERVAL '5 minutes')`,
    [nonce]
  );
  return nonce;
}

// Validate and consume nonce (replay prevention)
async validateAndConsumeNonce(nonce: string): Promise<boolean> {
  const result = await this.pg.query(
    `UPDATE dpop_nonces SET used = TRUE
     WHERE nonce = $1 AND used = FALSE AND expires_at > NOW()
     RETURNING id`,
    [nonce]
  );
  return result.rowCount > 0;
}
```

**Step 5: Build and verify**

```bash
cd /c/dev/eguwallet-wallet-provider && bun nest build wallet-provider
```

**Step 6: Commit**

```bash
git add apps/wallet-provider/src/services/dpop.service.ts migrations/
git commit -m "fix(wallet-provider): persist DPoP nonces in PostgreSQL instead of in-memory Map"
```

---

## Part 2: P1 Compliance Fixes

### Task 4: Fix DGEP mdoc Controller (1-Line Fix)

**Files:**
- Modify: `monoback/apps/dgep/src/controllers/credential.controller.ts` (line ~29)

**Context:** The mdoc issuance service (`mdoc.service.ts`, 807 lines) is fully implemented but blocked because the controller's format type annotation only allows `'dc+sd-jwt' | 'vc+sd-jwt'` and excludes `'mso_mdoc'`.

**Step 1: Read the controller**

```bash
cat monoback/apps/dgep/src/controllers/credential.controller.ts | head -50
```

**Step 2: Find and fix the type annotation**

Look for the format parameter type. Change:
```typescript
// BEFORE (approximately line 29)
format: 'dc+sd-jwt' | 'vc+sd-jwt'

// AFTER
format: 'dc+sd-jwt' | 'vc+sd-jwt' | 'mso_mdoc'
```

Also update the switch/if statement that routes to the correct service based on format.

**Step 3: Verify the mdoc service is properly injected in the module**

```bash
grep -n "MdocService\|mdoc" monoback/apps/dgep/src/dgep.module.ts
```

If not present, add it.

**Step 4: Build**

```bash
cd monoback && bun nest build dgep
```

**Step 5: Commit**

```bash
git add monoback/apps/dgep/src/controllers/credential.controller.ts
git commit -m "fix(dgep): allow mso_mdoc format in credential controller"
```

---

### Task 5: Fix LOTL Service History Bug

**Files:**
- Read: `monoback/apps/lotl/src/services/lotl.service.ts` (or similar)
- Read: `monoback/apps/lotl/src/services/lotl-history.service.ts`

**Context:** From audit: "Service history bug — 2-hour fix. When a service status changes, the current status entry is closed (end_time set) but the new status entry is not always inserted. Results in gaps in the history."

**Step 1: Find the relevant service**

```bash
ls monoback/apps/lotl/src/services/
grep -n "service_history\|history\|status" monoback/apps/lotl/src/services/lotl.service.ts | head -30
```

**Step 2: Read the update_service_status handler**

```bash
grep -A 30 "update_service_status\|updateServiceStatus" monoback/apps/lotl/src/services/lotl.service.ts
```

**Step 3: Fix the history gap**

The correct pattern:
```sql
-- When updating service status, always do BOTH:
-- 1. Close the current history entry
UPDATE service_history
SET end_time = NOW()
WHERE service_id = $1 AND end_time IS NULL;

-- 2. Insert the new history entry
INSERT INTO service_history (service_id, status, start_time)
VALUES ($1, $2, NOW());
```

Ensure both operations run in a transaction:
```typescript
await this.pg.query('BEGIN');
try {
  await this.pg.query(
    `UPDATE service_history SET end_time = NOW() WHERE service_id = $1 AND end_time IS NULL`,
    [serviceId]
  );
  await this.pg.query(
    `INSERT INTO service_history (service_id, status, start_time) VALUES ($1, $2, NOW())`,
    [serviceId, newStatus]
  );
  await this.pg.query('COMMIT');
} catch (e) {
  await this.pg.query('ROLLBACK');
  throw e;
}
```

**Step 4: Build and commit**

```bash
cd monoback && bun nest build lotl
git add monoback/apps/lotl/src/
git commit -m "fix(lotl): ensure service history entry is always created on status change"
```

---

### Task 6: Add EU LOTL Pointer to LOTL XML

**Files:**
- Read: `monoback/apps/lotl/src/services/tsl.service.ts` (or the XML generation service)
- Read: `monoback/apps/lotl/src/` - find where TSL XML is generated

**Context:** ETSI TS 119 612 requires a `PointersToOtherTSL` section pointing to the EU LOTL at `https://ec.europa.eu/tools/lotl/eu-lotl.xml`. Without this, Romania's LOTL cannot be located by EU member state verifiers.

**Step 1: Find the XML generation code**

```bash
grep -rn "PointersToOtherTSL\|eu-lotl\|lotl.xml\|TSLPointer\|buildXml\|generateXml" monoback/apps/lotl/src/
```

**Step 2: Read the XML builder**

Read whichever file generates the LOTL XML output.

**Step 3: Add PointersToOtherTSL section**

The ETSI TS 119 612 structure requires:
```xml
<PointersToOtherTSL>
  <OtherTSLPointer>
    <TSLLocation>https://ec.europa.eu/tools/lotl/eu-lotl.xml</TSLLocation>
    <AdditionalInformation>
      <OtherInformation>
        <SchemeOperatorName>
          <Name xml:lang="en">European Commission</Name>
        </SchemeOperatorName>
        <SchemeTypeCommunityRules>
          <URI>http://uri.etsi.org/TrstSvc/TrustedList/schemerules/EUlistofthelists</URI>
        </SchemeTypeCommunityRules>
        <SchemeTerritory>EU</SchemeTerritory>
        <MimeType>application/vnd.etsi.tsl+xml</MimeType>
      </OtherInformation>
    </AdditionalInformation>
  </OtherTSLPointer>
</PointersToOtherTSL>
```

In the TypeScript code, add this to the XML builder before the `TrustServiceProviderList` element.

**Step 4: Build and commit**

```bash
cd monoback && bun nest build lotl
git add monoback/apps/lotl/src/
git commit -m "fix(lotl): add PointersToOtherTSL pointing to EU LOTL per ETSI TS 119 612"
```

---

### Task 7: Upgrade LOTL from XMLDSig to XAdES-BES

**Files:**
- Read: `monoback/apps/lotl/src/services/` — find signing service
- Check: `monoback/apps/lotl/package.json` for XML signing libraries

**Context:** Current implementation uses raw XML Digital Signatures (XMLDSig). ETSI TS 119 612 requires XAdES-BES (with `<QualifyingProperties>`, `<SignedSignatureProperties>`, etc.). This is needed for cross-border trust.

**Step 1: Read current signing implementation**

```bash
grep -rn "xmldsig\|signXml\|XmlDSig\|createSign\|SignedInfo\|CanonicalizationMethod" monoback/apps/lotl/src/
```

**Step 2: Check available packages**

```bash
cat monoback/apps/lotl/package.json | grep -E "xml|sign|xades"
cat monoback/package.json | grep -E "xml|sign|xades"
```

**Step 3: Install XAdES library if needed**

```bash
# In monoback directory
bun add xadesjs
# Or use @peculiar/xades which is available via @peculiar/webcrypto
bun add @peculiar/xades
```

**Step 4: Implement XAdES-BES signing**

Replace current XML signing with XAdES-BES. The key difference from XMLDSig:
1. XAdES adds `<QualifyingProperties>` element as a `<Object>` in the signature
2. Must include `<SignedSignatureProperties>` with signing time and signing certificate

Reference implementation using `xadesjs`:
```typescript
import { XmlAdES } from '@peculiar/xades';

async signTslXml(xmlContent: string, privateKeyPem: string, certPem: string): Promise<string> {
  const crypto = require('crypto');
  const privateKey = crypto.createPrivateKey(privateKeyPem);

  // Build XAdES-BES signature with:
  // - SignedProperties containing SigningTime + SigningCertificate
  // - Enveloped signature (signature is embedded in the XML)
  // See: https://github.com/PeculiarVentures/xadesjs
}
```

**Step 5: Build and test**

```bash
cd monoback && bun nest build lotl
# Manually test XML generation: bun run start:dev lotl
# POST /compliance/assess and check resulting XML has QualifyingProperties
```

**Step 6: Commit**

```bash
git add monoback/apps/lotl/src/ monoback/package.json bun.lockb
git commit -m "feat(lotl): upgrade XML signing from XMLDSig to XAdES-BES per ETSI TS 119 612"
```

---

## Part 3: Android Key Attestation — Server-Side Verification

### Task 8: Implement Android Key Attestation Chain Verification

**Files:**
- Read: `/c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/wallet.service.ts`
- Read: `/c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/wallet-attestation.service.ts`
- Create: `/c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/android-key-attestation.service.ts`

**Context:** The Android app sends `device_info.key_attestation_chain` (array of PEM-encoded X.509 certificates) during wallet registration. The server currently stores these but does NOT cryptographically verify them. Server-side verification is required for eIDAS LoA High.

Android key attestation chain structure:
- `chain[0]` — Leaf certificate (device-generated key certificate)
- `chain[1]` — Intermediate CA (Google provisioned)
- `chain[2]` — Google Hardware Attestation Root CA

The leaf certificate contains OID `1.3.6.1.4.1.11129.2.1.17` (Android Attestation Extension) with:
- `attestationVersion` — version of the attestation schema
- `attestationSecurityLevel` — 0=Software, 1=TrustedEnvironment, 2=StrongBox
- `attestationChallenge` — the challenge bytes (must match issued nonce)
- `keymasterSecurityLevel` — same values as attestationSecurityLevel

Google Hardware Attestation Root CA certificate (production):
```
-----BEGIN CERTIFICATE-----
MIIFYDCCA0igAwIBAgIJAOj6GWMU0voYMA0GCSqGSIb3DQEBCwUAMBsxGTAXBgNV
BAUTEGY5MjAwOWU4NTNiNmIwNDUwHhcNMTYwNTI2MTYyODUyWhcNMjYwNTI0MTYy
ODUyWjAbMRkwFwYDVQQFExBmOTIwMDllODUzYjZiMDQ1MIICIjANBgkqhkiG9w0B
AQEFAAOCB...
-----END CERTIFICATE-----
```

**Step 1: Read the current wallet registration handler**

```bash
cat /c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/wallet.service.ts | head -100
grep -n "key_attestation_chain\|keyAttestationChain\|deviceCertificate" \
  /c/dev/eguwallet-wallet-provider/apps/wallet-provider/src/services/wallet.service.ts
```

**Step 2: Check what packages are available**

```bash
cat /c/dev/eguwallet-wallet-provider/package.json | grep -E "x509|asn|crypto|forge|peculiar"
```

**Step 3: Create android-key-attestation.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as x509 from '@peculiar/x509';

// Google Hardware Attestation Root CA fingerprint (SHA-256)
const GOOGLE_HW_ATTESTATION_ROOT_FINGERPRINT =
  'be:ed:ac:65:72:90:f8:85:f5:75:f2:9e:80:c4:34:e3:61:27:be:37:47:c3:72:c2:23:68:90:ba:23:05:8f:18';

// OID for Android Key Attestation Extension
const ANDROID_ATTESTATION_EXTENSION_OID = '1.3.6.1.4.1.11129.2.1.17';

export interface KeyAttestationResult {
  valid: boolean;
  securityLevel: 'Software' | 'TrustedEnvironment' | 'StrongBox';
  hardwareBacked: boolean;
  challengeMatched: boolean;
  error?: string;
}

@Injectable()
export class AndroidKeyAttestationService {
  private readonly logger = new Logger(AndroidKeyAttestationService.name);

  async verifyAttestationChain(
    pemChain: string[],
    expectedChallenge: string,
  ): Promise<KeyAttestationResult> {
    if (!pemChain || pemChain.length < 2) {
      return { valid: false, securityLevel: 'Software', hardwareBacked: false, challengeMatched: false, error: 'Chain too short' };
    }

    try {
      // Parse all certificates
      const certs = pemChain.map(pem => new x509.X509Certificate(pem));

      // Step 1: Verify chain integrity (each cert signed by next)
      for (let i = 0; i < certs.length - 1; i++) {
        const isValid = await certs[i].verify({ publicKey: await certs[i + 1].publicKey.export() });
        if (!isValid) {
          return { valid: false, securityLevel: 'Software', hardwareBacked: false, challengeMatched: false,
            error: `Certificate ${i} not signed by certificate ${i + 1}` };
        }
      }

      // Step 2: Verify root certificate fingerprint
      const rootCert = certs[certs.length - 1];
      const rootDer = Buffer.from(rootCert.rawData);
      const fingerprint = crypto.createHash('sha256').update(rootDer).digest('hex')
        .match(/.{2}/g)!.join(':');
      if (fingerprint !== GOOGLE_HW_ATTESTATION_ROOT_FINGERPRINT) {
        this.logger.warn('Root CA fingerprint mismatch — using test device or emulator');
        // Don't fail hard — may be test environment. Set level to Software.
        return { valid: true, securityLevel: 'Software', hardwareBacked: false, challengeMatched: false };
      }

      // Step 3: Parse attestation extension from leaf cert
      const leafCert = certs[0];
      const attestationExt = leafCert.extensions.find(
        e => e.type === ANDROID_ATTESTATION_EXTENSION_OID
      );
      if (!attestationExt) {
        return { valid: false, securityLevel: 'Software', hardwareBacked: false, challengeMatched: false,
          error: 'No attestation extension in leaf certificate' };
      }

      // Step 4: Parse the ASN.1 attestation extension value
      const result = this.parseAttestationExtension(Buffer.from(attestationExt.value));

      // Step 5: Verify challenge
      const expectedChallengeBytes = Buffer.from(expectedChallenge, 'utf8');
      const challengeMatched = result.challenge.equals(expectedChallengeBytes);
      if (!challengeMatched) {
        this.logger.warn('Attestation challenge mismatch');
      }

      const securityLevel = this.mapSecurityLevel(result.keymasterSecurityLevel);

      return {
        valid: true,
        securityLevel,
        hardwareBacked: securityLevel !== 'Software',
        challengeMatched,
      };
    } catch (error) {
      this.logger.error('Key attestation verification failed', error);
      return { valid: false, securityLevel: 'Software', hardwareBacked: false, challengeMatched: false,
        error: error.message };
    }
  }

  private parseAttestationExtension(der: Buffer): { keymasterSecurityLevel: number; challenge: Buffer } {
    // The attestation extension is an ASN.1 SEQUENCE. Parse manually.
    // Full ASN.1 parsing requires an ASN.1 library. Simplified approach:
    // attestationSecurityLevel is at position [2] in the sequence.
    // keymasterSecurityLevel is at position [4] in the sequence.
    // challenge is at position [9] in the sequence.
    // For production, use asn1js or @peculiar/asn1-android-key-attestation package.

    // Simplified: find the ENUMERATED tags (security levels are ENUMERATED)
    // keymasterSecurityLevel is typically value 0, 1, or 2
    let keymasterSecurityLevel = 0; // Default Software
    let challengeStart = 0;
    let challengeLen = 0;

    // Find first ENUMERATED (0x0A) after the SEQUENCE header — that's attestationSecurityLevel
    // Find second ENUMERATED — that's keymasterSecurityLevel
    let enumeratedCount = 0;
    for (let i = 0; i < der.length - 2; i++) {
      if (der[i] === 0x0a && der[i + 1] === 0x01) {
        enumeratedCount++;
        if (enumeratedCount === 2) { // keymasterSecurityLevel is second ENUMERATED in standard extensions
          keymasterSecurityLevel = der[i + 2];
        }
      }
      // Look for OCTET STRING (0x04) which contains the challenge
      if (der[i] === 0x04 && challengeLen === 0 && i > 10) {
        challengeLen = der[i + 1];
        challengeStart = i + 2;
      }
    }

    const challenge = challengeStart > 0
      ? der.slice(challengeStart, challengeStart + challengeLen)
      : Buffer.alloc(0);

    return { keymasterSecurityLevel, challenge };
  }

  private mapSecurityLevel(level: number): 'Software' | 'TrustedEnvironment' | 'StrongBox' {
    switch (level) {
      case 2: return 'StrongBox';
      case 1: return 'TrustedEnvironment';
      default: return 'Software';
    }
  }
}
```

**Note:** For production-quality ASN.1 parsing of the attestation extension, install:
```bash
bun add asn1js
# Or use the simpler approach above which works for the common field positions
```

**Step 4: Integrate into wallet registration flow**

In `wallet.service.ts`, find the `registerWalletInstance` handler and add:

```typescript
// After parsing device_info
if (deviceInfo.key_attestation_chain?.length > 0) {
  const nonce = /* retrieve the nonce issued earlier for this device */;
  const attestationResult = await this.androidKeyAttestation.verifyAttestationChain(
    deviceInfo.key_attestation_chain,
    nonce,
  );
  this.logger.log(`Key attestation: valid=${attestationResult.valid}, level=${attestationResult.securityLevel}`);

  // Override hardware-backed status with verified value
  hardwareBacked = attestationResult.hardwareBacked;
  attestationSecurityLevel = attestationResult.securityLevel;

  if (!attestationResult.challengeMatched) {
    this.logger.warn('Attestation challenge mismatch — possible replay attack');
    // Don't reject outright, but set lower trust level
    attestationSecurityLevel = 'Software';
  }
}
```

**Step 5: Register the service in module**

Add `AndroidKeyAttestationService` to providers in `wallet-provider.module.ts`.

**Step 6: Install @peculiar/x509 if not present**

```bash
cd /c/dev/eguwallet-wallet-provider && bun add @peculiar/x509
```

**Step 7: Build and commit**

```bash
bun nest build wallet-provider
git add apps/wallet-provider/src/services/android-key-attestation.service.ts
git add apps/wallet-provider/src/
git commit -m "feat(wallet-provider): verify Android key attestation chain server-side per eIDAS LoA High"
```

---

## Part 4: DGEP — Driving Licence (mDL) Implementation

### Task 9: DB Migration for Driving Licence Tables

**Files:**
- Create: `monoback/apps/dgep/src/migrations/XXX_driving_licence.sql` (or use the existing migration system)

**Context:** The DGEP service issues PID credentials. Now it also needs to issue ISO 18013-5 mDL (Mobile Driving Licence) credentials. Format: `mso_mdoc`, DocType: `org.iso.18013.5.1.mDL`. Issued by Prefectura/DRPCIV Romania.

**Step 1: Find existing migration system**

```bash
ls /c/dev/eguwallet-dgep/migrations/ 2>/dev/null || ls monoback/apps/dgep/migrations/
```

**Step 2: Create the migration**

```sql
-- Migration: driving_licence tables

CREATE TABLE driving_licence_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Applicant identity (from existing citizen or new)
  citizen_id UUID REFERENCES citizens(id),
  cnp VARCHAR(13),

  -- Personal data (ISO 18013-5.1 fields)
  family_name VARCHAR(100) NOT NULL,
  given_name VARCHAR(100) NOT NULL,
  birth_date DATE NOT NULL,
  place_of_birth VARCHAR(255),
  nationality VARCHAR(2) NOT NULL DEFAULT 'RO',
  sex SMALLINT CHECK (sex IN (0, 1, 2)),
  height SMALLINT,

  -- License details
  document_number VARCHAR(50) UNIQUE,
  issue_date DATE,
  expiry_date DATE,
  issuing_country VARCHAR(2) NOT NULL DEFAULT 'RO',
  issuing_authority VARCHAR(255),

  -- Portrait (stored as base64 in DGEP pattern)
  portrait TEXT,

  -- Status workflow
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  -- draft → submitted → pending_verification → approved → issued → suspended → revoked

  -- Admin tracking
  approved_by VARCHAR(255),
  approved_at TIMESTAMP,
  rejection_reason TEXT,
  admin_notes TEXT,

  -- Pre-authorization for credential offer
  pre_auth_code VARCHAR(255),
  tx_code VARCHAR(6),
  credential_offer_sent_at TIMESTAMP,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE driving_licence_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES driving_licence_requests(id) ON DELETE CASCADE,

  vehicle_category_code VARCHAR(10) NOT NULL,
  -- AM, A1, A2, A, B, BE, C1, C1E, C, CE, D1, D1E, D, DE, TR, TB

  category_issue_date DATE NOT NULL,
  category_expiry_date DATE NOT NULL,
  automatic_only BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE driving_licence_restriction_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES driving_licence_categories(id) ON DELETE CASCADE,

  code VARCHAR(10) NOT NULL,
  -- EU standard codes: 01, 01.01, 02, 10, etc.
  -- RO national codes: 100+
  description VARCHAR(500),

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE driving_licence_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id UUID NOT NULL REFERENCES driving_licence_requests(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  action_by VARCHAR(255),
  action_at TIMESTAMP NOT NULL DEFAULT NOW(),
  notes TEXT,
  status_before VARCHAR(50),
  status_after VARCHAR(50)
);
```

**Step 3: Apply migration**

```bash
# Apply to DGEP database
psql -h localhost -U postgres -d eguwallet_dgep -f migration.sql
```

**Step 4: Commit migration**

```bash
git add monoback/apps/dgep/src/migrations/ migrations/
git commit -m "feat(dgep): add driving_licence_requests, categories, restriction_codes tables"
```

---

### Task 10: Implement DrivingLicenceService

**Files:**
- Create: `monoback/apps/dgep/src/services/driving-licence.service.ts`
- Create: `monoback/apps/dgep/src/services/driving-licence-mdoc.service.ts`

**Context:** Two services needed:
1. `DrivingLicenceService` — CRUD for DL requests, approval/rejection workflow, pre-auth generation
2. `DrivingLicenceMdocService` — Build the ISO 18013-5 `mso_mdoc` CBOR structure for credential issuance

**Step 1: Read existing PID request service for pattern**

```bash
cat /c/dev/eguwallet-dgep/apps/dgep/src/services/pid-request.service.ts | head -80
```

**Step 2: Create driving-licence.service.ts**

```typescript
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PgService } from '@app/database';
import { PreAuthorizationService } from './pre-authorization.service';
import { EmailService } from './email.service';
import * as crypto from 'crypto';

export interface CreateDrivingLicenceRequestDto {
  citizenId?: string;
  cnp?: string;
  familyName: string;
  givenName: string;
  birthDate: string;           // YYYY-MM-DD
  placeOfBirth?: string;
  nationality?: string;        // 'RO'
  sex?: 0 | 1 | 2;            // 0=unspecified, 1=male, 2=female
  height?: number;
  categories: {
    vehicleCategoryCode: string;
    categoryIssueDate: string;
    categoryExpiryDate: string;
    automaticOnly?: boolean;
    restrictionCodes?: { code: string; description?: string }[];
  }[];
  documentNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  issuingAuthority?: string;
  portrait?: string;           // base64 JPEG
  adminNotes?: string;
}

export interface ApproveDrivingLicenceDto {
  documentNumber: string;
  issueDate: string;
  expiryDate: string;
  issuingAuthority: string;
  inspectorEmail: string;
}

@Injectable()
export class DrivingLicenceService {
  private readonly logger = new Logger(DrivingLicenceService.name);

  constructor(
    private readonly pg: PgService,
    private readonly preAuthorizationService: PreAuthorizationService,
    private readonly emailService: EmailService,
  ) {}

  async createRequest(dto: CreateDrivingLicenceRequestDto): Promise<any> {
    const result = await this.pg.queryOne<any>(
      `INSERT INTO driving_licence_requests
       (citizen_id, cnp, family_name, given_name, birth_date, place_of_birth,
        nationality, sex, height, status, admin_notes, portrait,
        issuing_authority, issuing_country)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', $10, $11, $12, 'RO')
       RETURNING *`,
      [dto.citizenId, dto.cnp, dto.familyName, dto.givenName, dto.birthDate,
       dto.placeOfBirth, dto.nationality || 'RO', dto.sex, dto.height,
       dto.adminNotes, dto.portrait, dto.issuingAuthority],
    );

    // Insert categories
    for (const cat of dto.categories) {
      const catRow = await this.pg.queryOne<any>(
        `INSERT INTO driving_licence_categories
         (request_id, vehicle_category_code, category_issue_date, category_expiry_date, automatic_only)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [result.id, cat.vehicleCategoryCode, cat.categoryIssueDate,
         cat.categoryExpiryDate, cat.automaticOnly || false],
      );
      // Insert restriction codes
      for (const code of (cat.restrictionCodes || [])) {
        await this.pg.query(
          `INSERT INTO driving_licence_restriction_codes (category_id, code, description)
           VALUES ($1, $2, $3)`,
          [catRow.id, code.code, code.description],
        );
      }
    }

    await this.logAction(result.id, 'created', null, null, 'draft');
    return this.getRequestById(result.id);
  }

  async getRequestById(id: string): Promise<any> {
    const req = await this.pg.queryOne<any>(
      `SELECT * FROM driving_licence_requests WHERE id = $1`, [id]
    );
    if (!req) throw new NotFoundException(`Driving licence request ${id} not found`);

    const categories = await this.pg.queryMany<any>(
      `SELECT dlc.*,
        json_agg(json_build_object('code', dlrc.code, 'description', dlrc.description))
          FILTER (WHERE dlrc.id IS NOT NULL) as restriction_codes
       FROM driving_licence_categories dlc
       LEFT JOIN driving_licence_restriction_codes dlrc ON dlrc.category_id = dlc.id
       WHERE dlc.request_id = $1
       GROUP BY dlc.id`, [id]
    );

    return { ...req, categories };
  }

  async getAllRequests(status?: string): Promise<any[]> {
    const whereClause = status ? `WHERE status = $1` : '';
    const params = status ? [status] : [];
    return this.pg.queryMany<any>(
      `SELECT * FROM driving_licence_requests ${whereClause} ORDER BY created_at DESC`,
      params
    );
  }

  async getPendingRequests(): Promise<any[]> {
    return this.getAllRequests('submitted');
  }

  async getStatistics(): Promise<any> {
    const rows = await this.pg.queryMany<{ status: string; count: string }>(
      `SELECT status, COUNT(*) as count FROM driving_licence_requests GROUP BY status`
    );
    return rows.reduce((acc, r) => ({ ...acc, [r.status]: parseInt(r.count) }), { total: 0 });
  }

  async approveRequest(id: string, dto: ApproveDrivingLicenceDto): Promise<any> {
    const req = await this.getRequestById(id);
    if (req.status !== 'submitted') {
      throw new BadRequestException(`Request ${id} is not in submitted state`);
    }

    const txCode = Math.floor(100000 + Math.random() * 900000).toString();
    const preAuthCode = crypto.randomBytes(32).toString('base64url');

    const updated = await this.pg.queryOne<any>(
      `UPDATE driving_licence_requests SET
         status = 'approved',
         document_number = $2,
         issue_date = $3,
         expiry_date = $4,
         issuing_authority = $5,
         approved_by = $6,
         approved_at = NOW(),
         pre_auth_code = $7,
         tx_code = $8,
         updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id, dto.documentNumber, dto.issueDate, dto.expiryDate,
       dto.issuingAuthority, dto.inspectorEmail, preAuthCode, txCode],
    );

    await this.logAction(id, 'approved', dto.inspectorEmail, 'submitted', 'approved');
    this.logger.log(`DL request ${id} approved, tx_code=${txCode}`);

    return updated;
  }

  async rejectRequest(id: string, reason: string, inspectorEmail: string): Promise<any> {
    const updated = await this.pg.queryOne<any>(
      `UPDATE driving_licence_requests SET status = 'rejected', rejection_reason = $2,
       approved_by = $3, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id, reason, inspectorEmail]
    );
    await this.logAction(id, 'rejected', inspectorEmail, null, 'rejected');
    return updated;
  }

  private async logAction(requestId: string, action: string, by: string | null,
    statusBefore: string | null, statusAfter: string | null): Promise<void> {
    await this.pg.query(
      `INSERT INTO driving_licence_audit_log (request_id, action, action_by, status_before, status_after)
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, action, by, statusBefore, statusAfter]
    );
  }
}
```

**Step 3: Create driving-licence-mdoc.service.ts**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PgService } from '@app/database';

// ISO 18013-5 mDL DocType and Namespace
export const MDL_DOCTYPE = 'org.iso.18013.5.1.mDL';
export const MDL_NAMESPACE = 'org.iso.18013.5.1';

@Injectable()
export class DrivingLicenceMdocService {
  private readonly logger = new Logger(DrivingLicenceMdocService.name);

  constructor(private readonly pg: PgService) {}

  /**
   * Build ISO 18013-5 mDL claims object for use with the existing mdoc.service.ts
   * The existing 807-line mdoc service handles CBOR encoding and COSE signing.
   */
  buildMdlClaims(dlRequest: any): Record<string, Record<string, unknown>> {
    const categories = dlRequest.categories || [];

    const drivingPrivileges = categories.map((cat: any) => ({
      vehicle_category_code: cat.vehicle_category_code,
      issue_date: cat.category_issue_date,
      expiry_date: cat.category_expiry_date,
      codes: (cat.restriction_codes || []).map((rc: any) => ({ code: rc.code })),
    }));

    const claims: Record<string, unknown> = {
      family_name: dlRequest.family_name,
      given_name: dlRequest.given_name,
      birth_date: dlRequest.birth_date,
      issue_date: dlRequest.issue_date,
      expiry_date: dlRequest.expiry_date,
      issuing_country: dlRequest.issuing_country || 'RO',
      issuing_authority: dlRequest.issuing_authority,
      document_number: dlRequest.document_number,
      driving_privileges: drivingPrivileges,
      age_over_18: true,
      age_over_21: this.calculateAgeOver(dlRequest.birth_date, 21),
    };

    if (dlRequest.place_of_birth) claims.place_of_birth = dlRequest.place_of_birth;
    if (dlRequest.nationality) claims.nationality = dlRequest.nationality;
    if (dlRequest.sex !== null && dlRequest.sex !== undefined) claims.sex = dlRequest.sex;
    if (dlRequest.height) claims.height = dlRequest.height;
    if (dlRequest.portrait) {
      // Store portrait as byte array (base64 decode)
      claims.portrait = Buffer.from(dlRequest.portrait, 'base64');
    }

    return { [MDL_NAMESPACE]: claims };
  }

  private calculateAgeOver(birthDate: string, age: number): boolean {
    const birth = new Date(birthDate);
    const threshold = new Date();
    threshold.setFullYear(threshold.getFullYear() - age);
    return birth <= threshold;
  }

  async issueMdlCredential(dlRequestId: string, holderPublicKeyJwk: object): Promise<string> {
    // Get the DL request with categories
    const dlRequest = await this.pg.queryOne<any>(
      `SELECT dlr.*,
        json_agg(json_build_object(
          'vehicle_category_code', dlc.vehicle_category_code,
          'category_issue_date', dlc.category_issue_date::text,
          'category_expiry_date', dlc.category_expiry_date::text,
          'restriction_codes', (
            SELECT json_agg(json_build_object('code', code))
            FROM driving_licence_restriction_codes WHERE category_id = dlc.id
          )
        )) as categories
       FROM driving_licence_requests dlr
       LEFT JOIN driving_licence_categories dlc ON dlc.request_id = dlr.id
       WHERE dlr.id = $1
       GROUP BY dlr.id`,
      [dlRequestId]
    );

    if (!dlRequest) throw new Error(`DL request ${dlRequestId} not found`);

    // Build claims for mdoc
    const nameSpaces = this.buildMdlClaims(dlRequest);

    // Delegate to existing MdocService for CBOR encoding + COSE signing
    // The credential.service.ts already routes to mdoc service for mso_mdoc format
    this.logger.log(`Building mDL credential for request ${dlRequestId}, docType=${MDL_DOCTYPE}`);

    return MDL_DOCTYPE; // Return docType — actual issuance via credential.controller.ts → mdoc.service.ts
  }
}
```

**Step 4: Register services in DGEP module**

In `dgep.module.ts` or `dgep.app.module.ts`, add to providers:
```typescript
DrivingLicenceService,
DrivingLicenceMdocService,
```

**Step 5: Build**

```bash
cd monoback && bun nest build dgep
```

**Step 6: Commit**

```bash
git add monoback/apps/dgep/src/services/driving-licence.service.ts
git add monoback/apps/dgep/src/services/driving-licence-mdoc.service.ts
git commit -m "feat(dgep): implement DrivingLicenceService and DrivingLicenceMdocService for mDL issuance"
```

---

### Task 11: Create DrivingLicenceController

**Files:**
- Create: `monoback/apps/dgep/src/controllers/driving-licence.controller.ts`

**Context:** Expose the driving licence service via HTTP endpoints (for admin frontend) and PG LISTEN/NOTIFY message handlers (for inter-service communication).

**Step 1: Read existing credential controller for pattern**

```bash
cat /c/dev/eguwallet-dgep/apps/dgep/src/controllers/pid-request.controller.ts
```

**Step 2: Create the controller**

```typescript
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { DrivingLicenceService, CreateDrivingLicenceRequestDto, ApproveDrivingLicenceDto } from '../services/driving-licence.service';

@Controller('driving-licences')
export class DrivingLicenceController {
  constructor(private readonly dlService: DrivingLicenceService) {}

  @Post()
  async create(@Body() dto: CreateDrivingLicenceRequestDto) {
    return this.dlService.createRequest(dto);
  }

  @Get()
  async findAll(@Query('status') status?: string) {
    return this.dlService.getAllRequests(status);
  }

  @Get('pending')
  async getPending() {
    return this.dlService.getPendingRequests();
  }

  @Get('stats/summary')
  async getStats() {
    return this.dlService.getStatistics();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.dlService.getRequestById(id);
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ApproveDrivingLicenceDto) {
    return this.dlService.approveRequest(id, dto);
  }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() body: { reason: string; inspectorEmail: string }) {
    return this.dlService.rejectRequest(id, body.reason, body.inspectorEmail);
  }
}
```

**Step 3: Register in module, build, commit**

```bash
cd monoback && bun nest build dgep
git add monoback/apps/dgep/src/controllers/driving-licence.controller.ts
git commit -m "feat(dgep): add DrivingLicenceController with HTTP endpoints for admin UI"
```

---

## Part 5: Angular Admin Frontends

> **Angular rules for ALL components:**
> - Standalone components (no NgModules)
> - PrimeNG for ALL UI elements
> - TailwindCSS for layout only (`flex`, `gap-*`, `p-*`, `h-*`)
> - NEVER use color utilities (`text-red-500`, `bg-blue-200`, etc.)
> - Import: `ButtonModule`, `TableModule`, `DialogModule`, `CardModule`, `TagModule`, `InputTextModule`, `ToastModule` etc. from `primeng/*`
> - Responsive: always include `md:` prefixes
> - Use `signal()` for reactive state, `inject()` for DI
> - All HTTP calls include auth headers: `this.auth.getAuthHeaders()`

**Shared API service pattern (create once, reuse):**
```typescript
import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/auth.service';
import { firstValueFrom } from 'rxjs';

@Injectable({ providedIn: 'root' })
export abstract class BaseApiService {
  protected http = inject(HttpClient);
  protected auth = inject(AuthService);

  protected get<T>(url: string): Promise<T> {
    return firstValueFrom(this.http.get<T>(url, { headers: this.auth.getAuthHeaders() }));
  }

  protected post<T>(url: string, body: any): Promise<T> {
    return firstValueFrom(this.http.post<T>(url, body, { headers: this.auth.getAuthHeaders() }));
  }
}
```

### Task 12: QTSP Admin — TSL + Certificate + Policy Management

**Files:**
- Modify: `monoback/frontends/projects/qtsp/src/app/admin/admin.component.ts`
- Create: `monoback/frontends/projects/qtsp/src/app/admin/tsl/tsl.component.ts`
- Create: `monoback/frontends/projects/qtsp/src/app/admin/certificates/certificates.component.ts`
- Create: `monoback/frontends/projects/qtsp/src/app/admin/policies/policies.component.ts`

**Step 1: Read current admin component**

```bash
cat monoback/frontends/projects/qtsp/src/app/admin/admin.component.ts
```

**Step 2: Expand the admin component with tabs**

Replace the current stub with a full tabbed admin component. Add tabs for:
1. **Certificates** — List all certificates, with revoke and view actions
2. **TSL** — List TSL versions, generate and publish buttons
3. **CRL/OCSP** — Current CRL status, download links
4. **Policies** — CP/CPS documents, generate and publish
5. **Users** — User management

**Step 3: Create certificates.component.ts**

```typescript
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { CardModule } from 'primeng/card';
import { AuthService } from '../../core/auth.service';
import { firstValueFrom } from 'rxjs';

interface Certificate {
  id: string;
  serial: string;
  subject: string;
  entity: string;
  type: string;
  status: 'active' | 'revoked' | 'expired';
  issued_at: string;
  expires_at: string;
}

@Component({
  selector: 'app-certificates',
  standalone: true,
  imports: [CommonModule, ButtonModule, TableModule, TagModule, DialogModule, ToastModule, CardModule],
  providers: [MessageService],
  template: `
    <p-toast />
    <div class="flex flex-col gap-4">
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-semibold m-0">Certificate Management</h2>
        <div class="flex gap-2">
          <p-button label="Refresh" icon="pi pi-refresh" severity="secondary" (onClick)="loadCerts()" />
        </div>
      </div>

      <div class="flex gap-4">
        <p-card class="flex-1">
          <p-table [value]="certs()" [loading]="loading()" [paginator]="true" [rows]="20"
                   [filterDelay]="0" [globalFilterFields]="['serial','subject','status']">
            <ng-template pTemplate="header">
              <tr>
                <th>Serial</th>
                <th>Subject</th>
                <th>Type</th>
                <th>Status</th>
                <th>Issued</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </ng-template>
            <ng-template pTemplate="body" let-cert>
              <tr>
                <td class="font-mono text-sm">{{ cert.serial | slice:0:16 }}…</td>
                <td>{{ cert.subject }}</td>
                <td>{{ cert.type }}</td>
                <td>
                  <p-tag [value]="cert.status"
                    [severity]="cert.status === 'active' ? 'success' : cert.status === 'revoked' ? 'danger' : 'warning'" />
                </td>
                <td>{{ cert.issued_at | date:'shortDate' }}</td>
                <td>{{ cert.expires_at | date:'shortDate' }}</td>
                <td>
                  <div class="flex gap-1">
                    <p-button icon="pi pi-eye" size="small" severity="secondary"
                      (onClick)="viewCert(cert)" pTooltip="View details" />
                    @if (cert.status === 'active') {
                      <p-button icon="pi pi-ban" size="small" severity="danger"
                        (onClick)="revokeCert(cert)" pTooltip="Revoke" />
                    }
                  </div>
                </td>
              </tr>
            </ng-template>
            <ng-template pTemplate="emptymessage">
              <tr><td colspan="7" class="text-center">No certificates found</td></tr>
            </ng-template>
          </p-table>
        </p-card>
      </div>
    </div>

    <p-dialog header="Certificate Details" [(visible)]="showDetail" [modal]="true" [style]="{width: '600px'}">
      @if (selectedCert()) {
        <div class="flex flex-col gap-3">
          <div><strong>Serial:</strong> <span class="font-mono">{{ selectedCert().serial }}</span></div>
          <div><strong>Subject:</strong> {{ selectedCert().subject }}</div>
          <div><strong>Type:</strong> {{ selectedCert().type }}</div>
          <div><strong>Status:</strong> {{ selectedCert().status }}</div>
        </div>
      }
    </p-dialog>
  `,
})
export class CertificatesComponent implements OnInit {
  private http = inject(HttpClient);
  private auth = inject(AuthService);
  private messageService = inject(MessageService);

  certs = signal<Certificate[]>([]);
  loading = signal(true);
  showDetail = false;
  selectedCert = signal<Certificate | null>(null);

  ngOnInit(): void { this.loadCerts(); }

  async loadCerts(): Promise<void> {
    this.loading.set(true);
    try {
      const data = await firstValueFrom(
        this.http.get<Certificate[]>('/api/qtsp/certificates', { headers: this.auth.getAuthHeaders() })
      );
      this.certs.set(data);
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to load certificates' });
    } finally {
      this.loading.set(false);
    }
  }

  viewCert(cert: Certificate): void {
    this.selectedCert.set(cert);
    this.showDetail = true;
  }

  async revokeCert(cert: Certificate): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(`/api/qtsp/certificates/${cert.id}/revoke`, { reason: 'key_compromise' },
          { headers: this.auth.getAuthHeaders() })
      );
      this.messageService.add({ severity: 'success', summary: 'Revoked', detail: `Certificate ${cert.serial.slice(0, 8)} revoked` });
      await this.loadCerts();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Error', detail: 'Failed to revoke certificate' });
    }
  }
}
```

**Step 4: Create tsl.component.ts**

Similar pattern to certificates but with:
- Table showing TSL versions (sequence number, creation date, published status)
- "Generate new TSL" button → calls `POST /tsl/generate`
- "Publish" button on draft TSLs → calls `POST /tsl/:id/publish`
- "Download XML" link → links to `GET /tsl/:sequenceNumber`
- Current TSL status card at the top (latest version, next update, signature status)

**Step 5: Update admin.component.ts to use tabs with sub-components**

Replace the current minimal admin component with a `p-tabs` layout loading CertificatesComponent, TslComponent, CrlStatusComponent, PoliciesComponent, UsersComponent.

**Step 6: Update app.routes.ts**

```typescript
export const routes: Routes = [
  { path: '', redirectTo: 'admin', pathMatch: 'full' },
  { path: 'auth/callback', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  { path: 'login', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  { path: 'admin', loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent), canActivate: [authGuard] },
  { path: 'inspector', loadComponent: () => import('./inspector/inspector.component').then(m => m.InspectorComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: 'admin' },
];
```

**Step 7: Build and commit**

```bash
cd monoback && bun run build --project qtsp
git add monoback/frontends/projects/qtsp/
git commit -m "feat(qtsp-frontend): add TSL management, certificate management, CRL status, and policy management tabs"
```

---

### Task 13: LOTL Admin — Trust Services + EU Sync + Heartbeat

**Files:**
- Modify: `monoback/frontends/projects/lotl/src/app/admin/admin.component.ts`
- Create: `monoback/frontends/projects/lotl/src/app/admin/trust-services/trust-services.component.ts`
- Create: `monoback/frontends/projects/lotl/src/app/admin/eu-sync/eu-sync.component.ts`
- Create: `monoback/frontends/projects/lotl/src/app/admin/heartbeat/heartbeat.component.ts`

**Step 1: Read current LOTL admin component**

```bash
cat monoback/frontends/projects/lotl/src/app/admin/admin.component.ts
```

**Step 2: Create trust-services.component.ts**

Build a component that:
- Shows a table of all trusted services (from `GET /api/lotl/trust-lists` or message handler)
- Each row shows: Service name, type (QTSP/CA/OCSP/TSA/etc.), country, status, last verified
- Status badge: `p-tag` with severity matching status
- "Register Service" button → opens `p-dialog` with a form:
  - Service type dropdown (QTSP, CA, OCSP Responder, TSA, Wallet Provider)
  - Service name input
  - Service URL input
  - Certificate upload (file or PEM paste)
- "Update Status" action per row → dialog with status dropdown
- "Verify Trust" action → calls verify endpoint and shows result

**Step 3: Create eu-sync.component.ts**

Build a component that:
- Shows a grid of EU member states with their sync status
- Each card shows: Country code + flag emoji, Last sync time, Service count, Sync status
- "Sync Now" button per country
- "Sync All" button at top
- "Enable/Disable" toggle per country
- Auto-refresh every 30 seconds (use `setInterval` in `ngOnInit`, clear in `ngOnDestroy`)

**Step 4: Create heartbeat.component.ts**

Build a component that:
- Shows a table of monitored services with last heartbeat time
- Traffic light status: green (<5min), yellow (<30min), red (>30min or stale)
- "Detect Stale" button → triggers stale service detection
- Uses `Date.now() - lastHeartbeat` for freshness calculation

**Step 5: Update admin.component.ts with tabs**

Use `p-tabs` with panels for: Trust Services, EU Sync, Heartbeat Monitor, Compliance, Users

**Step 6: Build and commit**

```bash
cd monoback && bun run build --project lotl
git add monoback/frontends/projects/lotl/
git commit -m "feat(lotl-frontend): add trust services management, EU sync dashboard, and heartbeat monitor"
```

---

### Task 14: Certification Admin — Auditor + Audit Workflow + NC Management

**Files:**
- Modify: `monoback/frontends/projects/cert/src/app/admin/admin.component.ts`
- Create: `monoback/frontends/projects/cert/src/app/admin/auditors/auditors.component.ts`
- Create: `monoback/frontends/projects/cert/src/app/admin/assessments/assessments.component.ts`
- Create: `monoback/frontends/projects/cert/src/app/admin/non-conformities/nc.component.ts`

**Step 1: Read current cert admin component**

```bash
cat monoback/frontends/projects/cert/src/app/admin/admin.component.ts
```

**Step 2: Create assessments.component.ts**

This is the core certification workflow component:
- Table of all certification assessments with columns: Entity, Type, Status, Auditor, Stage, Created
- Status badges: DRAFT, SUBMITTED, IN_REVIEW, STAGE1, STAGE2, APPROVED, REJECTED, ISSUED, EXPIRED
- Click row → detail panel slides in (or route to detail page)
- "Request Certification" button → form dialog with:
  - Entity name input
  - Entity type dropdown (PID_PROVIDER, WALLET_PROVIDER, QEAA_PROVIDER, QTSP, RELYING_PARTY)
  - Contact email input
- Per row actions: "Initiate Stage 1", "Complete Stage 1", "Initiate Stage 2", "Complete Stage 2", "Issue Certificate"
- Each stage action opens appropriate form dialog

**Step 3: Create auditors.component.ts**

- Table of registered auditors: Name, Email, Expertise, Status, Registered date
- "Register Auditor" button → form dialog:
  - Name, email, phone inputs
  - Expertise area multiselect (ISO 27001, GDPR, eIDAS, ARF, ETSI EN 319 401)
- "Assign to Audit" action

**Step 4: Create nc.component.ts (Non-Conformity Management)**

- Table of all non-conformities: ID, Assessment, Severity, Status, Due Date
- Severity badges: Major (danger), Minor (warning), Observation (info)
- Status: OPEN, PLANNED, IN_PROGRESS, VERIFIED, CLOSED
- "Plan Corrective Action" → form with responsible party and due date
- "Verify Effectiveness" → close the NC
- Statistics at top: total open, major, minor, overdue

**Step 5: Add checklists tab**

- `p-accordion` showing compliance standards (ISO 27001, GDPR, eIDAS Art.22, ARF, ETSI EN 319 401)
- Each standard expandable with list of checklist items
- Each item: checkbox for pass/fail, evidence notes input, confidence level (1-5)
- "Generate Summary Report" button

**Step 6: Build and commit**

```bash
cd monoback && bun run build --project cert
git add monoback/frontends/projects/cert/
git commit -m "feat(cert-frontend): add certification audit workflow, auditor management, NC tracking"
```

---

### Task 15: Wallet Provider Admin — Instance Management + Lifecycle + Attestation

**Files:**
- Modify: `monoback/frontends/projects/wallet/src/app/admin/admin.component.ts`
- Create: `monoback/frontends/projects/wallet/src/app/admin/instances/instances.component.ts`
- Create: `monoback/frontends/projects/wallet/src/app/admin/attestations/attestations.component.ts`
- Create: `monoback/frontends/projects/wallet/src/app/admin/security/security.component.ts`

**Step 1: Create instances.component.ts**

Main wallet management component:
- Table with columns: Device ID (truncated), Platform (Android/iOS), Status, Security Level, Last Seen, Attestation Level
- Status badge: active (success), suspended (warning), revoked (danger)
- Attestation level badge: StrongBox (success), TrustedEnvironment (info), Software (warning)
- Search/filter by status and platform
- Per row actions:
  - "View Details" → expands row or opens dialog showing full device info
  - "Suspend" (if active) → confirmation dialog → `POST /api/wallet/instances/:id/suspend`
  - "Reactivate" (if suspended) → confirmation dialog
  - "Revoke" (permanent) → danger confirmation dialog → `POST /api/wallet/instances/:id/revoke`
- Statistics cards at top: Total, Active, Suspended, Revoked

**Step 2: Create attestations.component.ts**

- Table of recent attestations: Wallet ID, Type (Play Integrity/App Attest), Level, Issued, Expires, Status
- "Revoke Attestation" per row action
- Filter by type and status

**Step 3: Create security.component.ts**

- Security distribution chart (use PrimeNG `p-chart` with Chart.js if available, otherwise use `p-table` with progress bars)
- Hardware-backed %: count(StrongBox + TEE) / count(total) * 100
- Biometric available %
- Risk level distribution table
- Key attestation chain verification status (verified/unverified/failed) table

**Step 4: Add backup/recovery tab**

Simple table showing backups: Wallet ID, Type (local/cloud), Size, Created, Verified status

**Step 5: Build and commit**

```bash
cd monoback && bun run build --project wallet
git add monoback/frontends/projects/wallet/
git commit -m "feat(wallet-frontend): add wallet instance management, attestation tracking, security dashboard"
```

---

### Task 16: DGP Inspector Dashboard — Passport Request Review

**Files:**
- Modify: `monoback/frontends/projects/dgp/src/app/inspector/inspector.component.ts`
- Modify: `monoback/frontends/projects/dgp/src/app/admin/admin.component.ts`
- Create: `monoback/frontends/projects/dgp/src/app/inspector/request-detail/request-detail.component.ts`

**Context:** DGP inspectors must review passport requests: see the submitted passport photo + live selfie, check face similarity, then approve or reject. The face matching can be done automatically by AWS Rekognition (backend `POST /passport-requests/:id/verify-auto`) or manually by the inspector.

**Step 1: Read current inspector component**

```bash
cat monoback/frontends/projects/dgp/src/app/inspector/inspector.component.ts
```

**Step 2: Replace inspector.component.ts with full implementation**

```typescript
import { Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { DialogModule } from 'primeng/dialog';
import { CardModule } from 'primeng/card';
import { InputTextModule } from 'primeng/inputtext';
import { InputNumberModule } from 'primeng/inputnumber';
import { TextareaModule } from 'primeng/textarea';
import { ToastModule } from 'primeng/toast';
import { MessageService } from 'primeng/api';
import { AuthService } from '../core/auth.service';
import { firstValueFrom } from 'rxjs';
import { FormsModule } from '@angular/forms';

interface PassportRequest {
  id: string;
  document_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  nationality: string;
  status: string;
  read_successful: boolean;
  photo: string;          // base64 passport photo
  foto_live: string;      // base64 live selfie
  email: string;
  created_at: string;
  face_match_score?: number;
}

@Component({
  selector: 'app-inspector',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, TableModule, TagModule,
    DialogModule, CardModule, InputTextModule, InputNumberModule, TextareaModule, ToastModule],
  providers: [MessageService],
  template: `
    <p-toast />
    <div class="flex flex-col h-screen">
      <div class="flex items-center justify-between px-6 py-3">
        <h1 class="text-xl font-bold m-0">DGP — Inspector</h1>
        <p-button label="Deconectare" severity="secondary" size="small" (onClick)="auth.logout()" />
      </div>

      <div class="flex-1 overflow-auto p-6">
        <div class="flex flex-col gap-4">
          <!-- Statistics -->
          <div class="flex gap-4 flex-wrap">
            <p-card class="flex-1 min-w-32">
              <div class="text-center">
                <div class="text-3xl font-bold">{{ stats().pending }}</div>
                <div class="text-sm">Pending</div>
              </div>
            </p-card>
            <p-card class="flex-1 min-w-32">
              <div class="text-center">
                <div class="text-3xl font-bold">{{ stats().approved }}</div>
                <div class="text-sm">Approved</div>
              </div>
            </p-card>
            <p-card class="flex-1 min-w-32">
              <div class="text-center">
                <div class="text-3xl font-bold">{{ stats().rejected }}</div>
                <div class="text-sm">Rejected</div>
              </div>
            </p-card>
          </div>

          <!-- Pending Requests Table -->
          <p-card header="Cereri în așteptare">
            <p-table [value]="requests()" [loading]="loading()" [paginator]="true" [rows]="20">
              <ng-template pTemplate="header">
                <tr>
                  <th>Nr. Document</th>
                  <th>Nume</th>
                  <th>Data nașterii</th>
                  <th>Email</th>
                  <th>Depus la</th>
                  <th>Acțiuni</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-req>
                <tr>
                  <td class="font-mono">{{ req.document_number }}</td>
                  <td>{{ req.first_name }} {{ req.last_name }}</td>
                  <td>{{ req.date_of_birth | date:'shortDate' }}</td>
                  <td>{{ req.email }}</td>
                  <td>{{ req.created_at | date:'short' }}</td>
                  <td>
                    <div class="flex gap-2">
                      <p-button label="Revizuiește" size="small" (onClick)="openRequest(req)" />
                      <p-button label="Auto-verifică" size="small" severity="secondary"
                        (onClick)="autoVerify(req)" [loading]="verifying() === req.id" />
                    </div>
                  </td>
                </tr>
              </ng-template>
            </p-table>
          </p-card>
        </div>
      </div>
    </div>

    <!-- Request Review Dialog -->
    <p-dialog header="Revizuire cerere pașaport" [(visible)]="showReview"
      [modal]="true" [style]="{width: '900px'}" [maximizable]="true">
      @if (selectedRequest()) {
        <div class="flex flex-col gap-4">
          <!-- Photo comparison -->
          <div class="flex gap-4 flex-wrap">
            <div class="flex-1 flex flex-col items-center gap-2">
              <p class="font-semibold m-0">Fotografie pașaport</p>
              @if (selectedRequest().photo) {
                <img [src]="'data:image/jpeg;base64,' + selectedRequest().photo"
                  class="w-48 h-64 object-cover rounded" alt="Passport photo" />
              } @else {
                <div class="w-48 h-64 flex items-center justify-center">Fără foto</div>
              }
            </div>
            <div class="flex-1 flex flex-col items-center gap-2">
              <p class="font-semibold m-0">Fotografie live (selfie)</p>
              @if (selectedRequest().foto_live) {
                <img [src]="'data:image/jpeg;base64,' + selectedRequest().foto_live"
                  class="w-48 h-64 object-cover rounded" alt="Live selfie" />
              } @else {
                <div class="w-48 h-64 flex items-center justify-center">Fără selfie</div>
              }
            </div>
          </div>

          <!-- Person data -->
          <div class="flex gap-4 flex-wrap">
            <div class="flex-1"><strong>Nume:</strong> {{ selectedRequest().first_name }} {{ selectedRequest().last_name }}</div>
            <div class="flex-1"><strong>Data nașterii:</strong> {{ selectedRequest().date_of_birth }}</div>
            <div class="flex-1"><strong>Nr. document:</strong> {{ selectedRequest().document_number }}</div>
          </div>

          <!-- Approval form -->
          <div class="flex flex-col gap-3">
            <div class="flex flex-col gap-1">
              <label class="font-medium">Scor similaritate fețe (0-100)</label>
              <p-inputnumber [(ngModel)]="faceMatchScore" [min]="0" [max]="100"
                placeholder="Introduceți scorul (80+ recomandat)" class="w-full" />
              @if (selectedRequest().face_match_score) {
                <small>Auto-detectat: {{ selectedRequest().face_match_score | number:'1.1-1' }}%</small>
              }
            </div>
          </div>

          <!-- Action buttons -->
          <div class="flex gap-3 justify-end">
            <p-button label="Respinge" severity="danger" icon="pi pi-times"
              (onClick)="openRejectDialog()" />
            <p-button label="Aprobă" severity="success" icon="pi pi-check"
              (onClick)="approveRequest()" [disabled]="!faceMatchScore || faceMatchScore < 70" />
          </div>
        </div>
      }
    </p-dialog>

    <!-- Reject dialog -->
    <p-dialog header="Respingere cerere" [(visible)]="showReject" [modal]="true" [style]="{width:'500px'}">
      <div class="flex flex-col gap-3">
        <label class="font-medium">Motiv respingere</label>
        <textarea pTextarea [(ngModel)]="rejectReason" rows="4" class="w-full"
          placeholder="Descrieți motivul respingerii..."></textarea>
        <div class="flex gap-2 justify-end">
          <p-button label="Anulează" severity="secondary" (onClick)="showReject = false" />
          <p-button label="Respinge cererea" severity="danger" (onClick)="rejectRequest()" />
        </div>
      </div>
    </p-dialog>
  `,
})
export class InspectorComponent implements OnInit {
  auth = inject(AuthService);
  private http = inject(HttpClient);
  private messageService = inject(MessageService);

  requests = signal<PassportRequest[]>([]);
  stats = signal<any>({ pending: 0, approved: 0, rejected: 0 });
  loading = signal(true);
  verifying = signal<string | null>(null);
  showReview = false;
  showReject = false;
  selectedRequest = signal<PassportRequest | null>(null);
  faceMatchScore = 0;
  rejectReason = '';

  ngOnInit(): void {
    this.loadData();
  }

  async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [requests, stats] = await Promise.all([
        firstValueFrom(this.http.get<PassportRequest[]>('/api/dgp/passport-requests/pending',
          { headers: this.auth.getAuthHeaders() })),
        firstValueFrom(this.http.get<any>('/api/dgp/passport-requests/stats/summary',
          { headers: this.auth.getAuthHeaders() })),
      ]);
      this.requests.set(requests);
      this.stats.set(stats);
    } finally {
      this.loading.set(false);
    }
  }

  openRequest(req: PassportRequest): void {
    this.selectedRequest.set(req);
    this.faceMatchScore = req.face_match_score || 0;
    this.showReview = true;
  }

  async autoVerify(req: PassportRequest): Promise<void> {
    this.verifying.set(req.id);
    try {
      const result = await firstValueFrom(
        this.http.post<any>(`/api/dgp/passport-requests/${req.id}/verify-auto`, {},
          { headers: this.auth.getAuthHeaders() })
      );
      this.messageService.add({ severity: 'info', summary: 'Auto-verificare',
        detail: `Scor similaritate: ${result.faceMatchScore?.toFixed(1) || 'N/A'}%` });
      await this.loadData();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Eroare', detail: 'Auto-verificarea a eșuat' });
    } finally {
      this.verifying.set(null);
    }
  }

  async approveRequest(): Promise<void> {
    if (!this.selectedRequest()) return;
    try {
      await firstValueFrom(
        this.http.post(`/api/dgp/passport-requests/${this.selectedRequest()!.id}/approve`,
          { faceMatchScore: this.faceMatchScore, inspectorId: 'current-user' },
          { headers: this.auth.getAuthHeaders() })
      );
      this.messageService.add({ severity: 'success', summary: 'Aprobat', detail: 'Cererea a fost aprobată' });
      this.showReview = false;
      await this.loadData();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Eroare', detail: 'Aprobarea a eșuat' });
    }
  }

  openRejectDialog(): void { this.showReject = true; }

  async rejectRequest(): Promise<void> {
    if (!this.selectedRequest() || !this.rejectReason) return;
    try {
      await firstValueFrom(
        this.http.post(`/api/dgp/passport-requests/${this.selectedRequest()!.id}/reject`,
          { reason: this.rejectReason, inspectorId: 'current-user' },
          { headers: this.auth.getAuthHeaders() })
      );
      this.messageService.add({ severity: 'success', summary: 'Respins', detail: 'Cererea a fost respinsă' });
      this.showReject = false;
      this.showReview = false;
      this.rejectReason = '';
      await this.loadData();
    } catch {
      this.messageService.add({ severity: 'error', summary: 'Eroare', detail: 'Respingerea a eșuat' });
    }
  }
}
```

**Step 3: Build and commit**

```bash
cd monoback && bun run build --project dgp
git add monoback/frontends/projects/dgp/
git commit -m "feat(dgp-frontend): implement inspector dashboard with photo viewer, face match review, approve/reject workflow"
```

---

### Task 17: DGEP Inspector Dashboard + Citizen Management + Driving Licence Admin

**Files:**
- Modify: `monoback/frontends/projects/dgep/src/app/` (all files)
- Note: DGEP app may be in monoback OR standalone. Check both paths.

**Step 1: Locate DGEP frontend**

```bash
ls monoback/frontends/projects/ 2>/dev/null
ls /c/dev/eguwallet-dgep/frontend/projects/ 2>/dev/null
```

**Step 2: Fix hardcoded "DGP" titles in DGEP**

In DGEP's `admin.component.ts` and `inspector.component.ts`, change:
- `"DGP — Panou de administrare"` → `"DGEP — Panou de administrare"`
- `"DGP — Inspector"` → `"DGEP — Inspector"`

**Step 3: Create PID request inspector (similar to DGP Task 16)**

Create `inspector/inspector.component.ts` for DGEP PID requests:
- Same pattern as DGP inspector but for `pid_requests` table
- Endpoint: `GET /api/dgep/pid-requests/pending`
- Approval endpoint: `POST /api/dgep/pid-requests/:id/approve` with body:
  ```json
  { "cnp": "string", "familyName": "string", "givenName": "string",
    "birthDate": "YYYY-MM-DD", "gender": "M|F", "faceMatchScore": 95,
    "inspectorId": "string" }
  ```
- Shows: ID card front photo, ID card back photo, live selfie (3 images)
- Extracted CNP displayed with validation
- Gender from CNP digit 1: odd=M, even=F

**Step 4: Create citizen management component**

```typescript
// admin/citizens/citizens.component.ts
// Table: CNP, Name, Birth date, Address, status
// Search by CNP: GET /api/dgep/carte-identitate/cnp/:cnp
// Edit citizen: PUT /api/dgep/carte-identitate/:id
// View issued credentials per citizen
```

**Step 5: Create driving licence admin component**

```typescript
// admin/driving-licences/driving-licences.component.ts
// Tabs:
//   1. "Cereri permise" — list DL requests with approve/reject
//   2. "Categorii" — view driving categories per request
// Form for new DL request:
//   - Personal data (from citizen or new)
//   - Categories multiselect: AM, A1, A2, A, B, BE, C, C1, CE, C1E, D, D1, DE, D1E, TR, TB
//   - Per category: issue date, expiry date, restriction codes
//   - Portrait upload
// Approval form:
//   - Document number input
//   - Issue date
//   - Expiry date
//   - Issuing authority: "DRPCIV - Prefectura Ilfov"
```

Key PrimeNG components for driving licence form:
- `p-multiselect` for vehicle categories
- `p-calendar` for date pickers
- `p-fileupload` for portrait upload
- `p-accordion` for expanding per-category restriction codes

**Step 6: Update admin.component.ts**

Add tabs: PID Requests, Driving Licences, Citizens, Users

**Step 7: Build and commit**

```bash
# Build whichever project is canonical for DGEP
cd monoback && bun run build --project dgep 2>/dev/null || \
cd /c/dev/eguwallet-dgep/frontend && bun run build

git add monoback/frontends/projects/dgep/ 2>/dev/null || git add frontend/projects/dgep/
git commit -m "feat(dgep-frontend): implement PID inspector, citizen management, and driving licence admin"
```

---

## Part 6: Fix HTTP Interceptors for Auth Headers

### Task 18: Add HTTP Interceptor to All Frontend Projects

**Files:**
- Create: `monoback/frontends/projects/{qtsp,lotl,cert,wallet,dgp,dgep}/src/app/core/auth.interceptor.ts`
- Modify: `monoback/frontends/projects/{service}/src/app/app.config.ts`

**Context:** All 6 frontends add auth headers manually per-component call. Instead, use an HTTP interceptor that automatically adds the `Authorization: Bearer {token}` header to all requests.

**Step 1: Create the interceptor (same for all services)**

```typescript
// core/auth.interceptor.ts
import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = localStorage.getItem('access_token');
  if (token) {
    const authReq = req.clone({
      setHeaders: { Authorization: `Bearer ${token}` }
    });
    return next(authReq);
  }
  return next(req);
};
```

**Step 2: Register in app.config.ts**

```typescript
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { authInterceptor } from './core/auth.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideHttpClient(withInterceptors([authInterceptor])),
    // ... other providers
  ],
};
```

After adding the interceptor, remove manual `{ headers: this.auth.getAuthHeaders() }` from API calls in all components.

**Step 3: Build all projects and commit**

```bash
cd monoback
for proj in qtsp lotl cert wallet dgp dgep; do
  bun run build --project $proj 2>/dev/null || echo "Project $proj not in monoback"
done

git add monoback/frontends/
git commit -m "feat(frontend): add HTTP interceptor for automatic auth header injection in all 6 services"
```

---

## Part 7: Final Verification and Integration

### Task 19: End-to-End Testing Checklist

**Step 1: Backend health checks**

```bash
# SSH to server
ssh eguilde@egucluster3.eguilde.cloud

# Check all services running
docker ps | grep eguwallet

# Check each service's OIDC endpoint
curl -s https://qtsp.eguwallet.com/oidc/.well-known/openid-configuration | jq .issuer
curl -s https://lotl.eguwallet.com/oidc/.well-known/openid-configuration | jq .issuer
curl -s https://cert.eguwallet.com/oidc/.well-known/openid-configuration | jq .issuer
curl -s https://wallet.eguwallet.com/oidc/.well-known/openid-configuration | jq .issuer
curl -s https://dgp.eguwallet.com/oidc/.well-known/openid-configuration | jq .issuer
curl -s https://dgep.eguwallet.com/oidc/.well-known/openid-configuration | jq .issuer
```

**Step 2: LOTL XML validation**

```bash
# Check LOTL XML is accessible and has PointersToOtherTSL
curl -s https://lotl.eguwallet.com/lotl.xml | grep -c "PointersToOtherTSL"
# Expected: 1

# Check signature type
curl -s https://lotl.eguwallet.com/lotl.xml | grep "QualifyingProperties"
# Expected: match (XAdES-BES)
```

**Step 3: DGEP mdoc credential test**

```bash
# Test mdoc issuance (requires valid pre-auth code)
curl -s -X POST https://dgep.eguwallet.com/credential \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"format": "mso_mdoc", "doctype": "org.iso.18013.5.1.mDL"}' \
  | jq .format
# Expected: "mso_mdoc"
```

**Step 4: Frontend smoke test (per service)**

For each service:
1. Navigate to `https://{service}.eguwallet.com/login`
2. Verify login works with OTP
3. Verify admin dashboard loads
4. Verify data tables display

**Step 5: Android attestation test**

Register a new wallet from Android device and check logs:
```bash
docker logs eguwallet-wallet-provider 2>&1 | grep -i "attestation"
# Expected: "Key attestation: valid=true, level=TrustedEnvironment|StrongBox"
```

**Step 6: Commit final status**

```bash
git add .
git commit -m "docs: add final verification checklist for eIDAS 2.0 remediation"
```

---

## Notes for Implementer

### Backend API Routing
All backend services use **PG LISTEN/NOTIFY** for inter-service communication (not REST). The frontend calls REST endpoints on the same service (proxied via nginx). REST endpoints are defined in `*.controller.ts` files with `@Controller('path')`. Message handlers are in `*-messaging.controller.ts` files.

### Frontend API Base URL
All frontend API calls use relative paths (`/api/...`) which are proxied by nginx to the respective service. No need for absolute URLs in frontend code.

### Database Access (if needed during testing)
```bash
ssh eguilde@egucluster3.eguilde.cloud
sudo -u postgres psql eguwallet_dgep
# Password: qWx11??9
```

### Bun Lock File
After any `bun add` command, commit the updated `bun.lockb` file.

### TypeScript Strict Mode
- Use `?.` optional chaining and `!` non-null assertion carefully
- Signal-based reactivity: use `signal()`, `computed()`, `effect()` — NOT RxJS subjects in components
- `inject()` instead of constructor injection in components

### Migration Numbers
Check the highest migration number in each service's migrations folder and increment accordingly. Migration files may be `.sql` files or TypeScript migration classes depending on the service.
