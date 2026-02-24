# eIDAS 2.0 PID/Passport Issuance Flow — Design Document

**Date:** 2026-02-24
**Status:** Approved
**Scope:** DGEP, DGP, wallet-provider, eguwallet-android

## Goal

Implement the complete eIDAS 2.0 document issuance flow: Android wallet wizard for document scanning + selfie capture, WIA-authenticated REST APIs on DGEP/DGP, admin review frontends, and email-based credential offer with OpenID4VCI issuance.

## Architecture

```
Android App                    Wallet Provider              DGEP/DGP
─────────────────────────────────────────────────────────────────────
1. Play Integrity ────────────► Verify + Issue WIA
2. Wizard: Choose doc type
3. Scan document (ML Kit)
4. Take selfie (ML Kit)
5. POST /api/document-requests ──────────────────────────► Store request
   (WIA + PoP + DPoP auth)                                (pending review)
                                                           │
                                 Admin Frontend ◄──────────┘
                                 Inspector reviews,
                                 fills PID/passport form,
                                 approves
                                                           │
6. Email with QR code ◄────────────────────────────────────┘
   (credential_offer_uri + tx_code)
7. Scan QR → POST /token ──────────────────────────────► Validate pre-auth
   (pre-authorized_code + tx_code + DPoP)                 Return access_token
8. POST /credential ────────────────────────────────────► Issue SD-JWT/mdoc
   (access_token + PoP JWT + DPoP)                        Return credential
9. Store credential locally
```

## Key Decisions

- **ML Kit client-side only** — no AWS Rekognition/Textract. Inspector manually extracts data from document photos.
- **Replace existing Android onboarding** — new wizard replaces 3-tab flow.
- **Admin frontends in DGEP/DGP repos** — minimal Angular apps in `frontend/` dirs.
- **WIA + DPoP authentication** — per eIDAS 2.0 ARF, no API keys or mTLS for app-to-issuer.

## Section 1: DGEP/DGP REST API for Document Requests

### DGEP Changes

Remove or deprecate `onboarding.controller.ts` self-service endpoints. Add new endpoint:

```
POST /api/document-requests
Headers:
  Client-Attestation: {WIA JWT}
  Client-Attestation-PoP: {PoP JWT}
  DPoP: {DPoP proof}
Body:
  {
    "documentType": "CI" | "ECI",
    "email": "user@example.com",
    "phone": "+40712345678",
    "documentScanFront": "base64...",
    "documentScanBack": "base64...",
    "selfiePhoto": "base64..."
  }
Response: { "requestId": "uuid", "status": "pending_review" }
```

Creates `document_requests` record. No email OTP — wallet-provider already verified email/phone.

### DGP Changes

Same endpoint pattern:

```
POST /api/document-requests
Body:
  {
    "documentType": "PASSPORT",
    "email": "user@example.com",
    "phone": "+40712345678",
    "documentScanFront": "base64...",
    "selfiePhoto": "base64..."
  }
```

### Authentication (Both Services)

WIA + Client Attestation PoP + DPoP per draft-ietf-oauth-attestation-based-client-auth:

1. Parse `Client-Attestation` header → WIA JWT
2. Fetch wallet-provider JWKS from `/.well-known/jwks` (cached)
3. Verify WIA signature, check not expired
4. Parse `Client-Attestation-PoP` header → PoP JWT
5. Verify PoP signed by key in WIA's `cnf` claim
6. Verify `aud` matches service URL
7. Verify DPoP proof (existing DPoP service)

### Database

New table `document_requests` (DGEP) / extend `passports` (DGP):

```sql
-- DGEP: document_requests
CREATE TABLE document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(10) NOT NULL, -- 'CI', 'ECI'
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  document_scan_front TEXT NOT NULL, -- base64
  document_scan_back TEXT,           -- base64 (null for some types)
  selfie_photo TEXT NOT NULL,        -- base64
  wallet_instance_id VARCHAR(255),   -- from WIA
  status VARCHAR(30) DEFAULT 'pending_review',
  -- Inspector fills these on approval:
  given_name VARCHAR(255),
  family_name VARCHAR(255),
  birth_date DATE,
  cnp VARCHAR(13),
  gender VARCHAR(10),
  nationality VARCHAR(50) DEFAULT 'RO',
  resident_address TEXT,
  resident_city VARCHAR(255),
  resident_postal_code VARCHAR(20),
  resident_country VARCHAR(10) DEFAULT 'RO',
  id_series VARCHAR(10),
  id_number VARCHAR(20),
  -- Review metadata:
  inspector_id VARCHAR(255),
  inspector_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Section 2: Android Wizard UI

Replace existing 3-tab onboarding (`OnboardingScreen.kt`) with step-by-step wizard.

### Step 1 — Choose Document Type

Full screen, 3 Material 3 cards in vertical list:
- "Carte de Identitate" (CI) — Romanian ID Card
- "Carte Electronică de Identitate" (ECI) — Electronic ID Card
- "Pașaport" (PASSPORT) — Passport

Top: horizontal stepper showing steps 1-2-3-4 with current step highlighted.

### Step 2 — Scan Document

Camera screen using CameraX + ML Kit Document Scanner:
- CI/ECI: scan front, then scan back (2 captures)
- Passport: scan data page only (1 capture)
- Preview after each capture with Retake / Continue
- ML Kit validates image quality

### Step 3 — Take Selfie

Camera screen using CameraX + ML Kit Face Detection:
- Oval face guide overlay
- Auto-detect face presence and centering
- Auto-capture or manual capture
- Face crop to standard portrait
- Preview with Retake / Submit

### Step 4 — Submit & Confirmation

- Show thumbnails of all captures + document type
- Submit button → calls DGEP or DGP based on document type
- Progress indicator during upload
- Success: "Request submitted. Check your email when approved."
- Error: retry option

### Data Model (Kotlin)

```kotlin
data class DocumentRequest(
    val documentType: DocumentType,  // CI, ECI, PASSPORT
    val email: String,
    val emailVerified: Boolean,
    val phone: String?,
    val phoneVerified: Boolean,
    val documentScanFront: ByteArray,
    val documentScanBack: ByteArray?,
    val selfiePhoto: ByteArray
)

enum class DocumentType { CI, ECI, PASSPORT }
```

### Submission Logic

```kotlin
// Determine which service to call
val baseUrl = when (request.documentType) {
    CI, ECI -> "https://dgep.eguwallet.eu"
    PASSPORT -> "https://dgp.eguwallet.eu"
}

// Get fresh WIA from attestation service
val wia = attestationService.getCurrentAttestation()

// Create Client-Attestation-PoP
val pop = createClientAttestationPoP(
    audience = baseUrl,
    walletInstanceKey = keyManagement.getKey(WALLET_INSTANCE)
)

// Create DPoP proof
val dpop = dpopManager.generateDPoPProof("POST", "$baseUrl/api/document-requests")

// POST with all three auth headers
api.submitDocumentRequest(baseUrl, request, wia, pop, dpop)
```

## Section 3: Admin Frontend (DGEP + DGP)

Minimal Angular 21 + PrimeNG + TailwindCSS apps in each service's `frontend/` dir.

### DGEP Admin (`dgep.eguwallet.eu/admin`)

**Pages:**
1. **Login** — OIDC via existing oidc module
2. **Dashboard** — pending count, recent requests
3. **Request List** — PrimeNG DataTable, filter by status
4. **Request Detail** — two-column layout:
   - Left: document scan images (p-image with zoom), selfie photo
   - Right: PID data form (p-inputtext fields for all citizen attributes)
   - Bottom: Approve / Reject buttons

**Approve flow:**
- Inspector fills form fields (given_name, family_name, birth_date, CNP, etc.)
- Click Approve → PATCH `/api/document-requests/:id/approve` with form data
- Backend creates citizen record, generates pre-auth + tx_code, sends credential offer email

**Reject flow:**
- Inspector enters rejection reason
- Click Reject → PATCH `/api/document-requests/:id/reject` with reason
- Backend sends rejection email

### DGP Admin (`dgp.eguwallet.eu/admin`)

Same structure with passport-specific form fields: first_name, last_name, nationality, date_of_birth, gender, document_number, expiry_date, issuing_state, personal_number.

### Tech Stack

- Angular 21 standalone components
- PrimeNG for all UI elements (p-table, p-button, p-inputtext, p-image, p-dialog)
- TailwindCSS for layout only (no colors — PrimeNG theme handles it)
- Served as static files by NestJS (ServeStaticModule)
- Dockerfile updated to include frontend build stage

## Section 4: WIA Authentication on DGEP/DGP

### New Service: `WiaAuthGuard` / `WiaAuthService`

Shared logic for both DGEP and DGP:

```typescript
// 1. Extract headers
const wiaJwt = request.headers['client-attestation'];
const popJwt = request.headers['client-attestation-pop'];
const dpopProof = request.headers['dpop'];

// 2. Fetch wallet-provider JWKS (cached 5min)
const jwks = await fetchWalletProviderJwks();

// 3. Verify WIA
const wia = verifyJwt(wiaJwt, jwks); // Check sig, exp, iss
if (wia.iss !== WALLET_PROVIDER_URL) throw Unauthorized;

// 4. Verify Client-Attestation-PoP
const holderKey = wia.cnf.jwk; // Key bound in WIA
verifyJwt(popJwt, holderKey);  // Check sig, aud, iat, exp, jti

// 5. Verify DPoP (existing service)
await dpopService.verifyDPoPProof(dpopProof, 'POST', requestUrl);
```

### Wallet-Provider JWKS Discovery

DGEP/DGP fetches `https://wallet.eguwallet.eu/.well-known/jwks` to get wallet-provider's public key. Cached with 5-minute TTL. This is how DGEP/DGP trusts the WIA without talking to Google directly.

## Section 5: Credential Offer Email + OpenID4VCI Flow

### After Inspector Approval

1. Create/upsert citizen record with form data
2. Generate pre-authorization code (32 bytes, base64url)
3. Generate TX code (6-digit numeric)
4. Build credential offer URI:
   ```
   openid-credential-offer://?credential_offer_uri=https://dgep.eguwallet.eu/api/credential-offers/{offerId}
   ```
5. Send email via Haraka with:
   - QR code image encoding the credential offer URI
   - TX code displayed prominently
   - Instructions in Romanian

### Wallet Scans QR (Existing Flow)

This flow already works end-to-end in both services + Android app:
1. Parse credential offer → extract pre-auth code + issuer URL
2. Fetch issuer metadata
3. POST /token with pre-auth code + tx_code + DPoP
4. POST /credential with access_token + PoP JWT + DPoP
5. Receive and store SD-JWT or mdoc credential

No changes needed to this part.

## What Already Exists vs What's New

| Component | Status | Work Needed |
|-----------|--------|-------------|
| DGEP OpenID4VCI flow | Exists | No changes |
| DGP OpenID4VCI flow | Exists | No changes |
| WIA issuance (wallet-provider) | Exists | No changes |
| DPoP (all services) | Exists | No changes |
| Pre-auth code generation | Exists | No changes |
| Credential offer email | Exists (DGEP), TODO (DGP) | Wire up DGP email |
| Android OpenID4VCI client | Exists | No changes |
| Android DPoP manager | Exists | No changes |
| Android attestation service | Exists | No changes |
| ML Kit document scanner | Exists (dependency) | Wire into wizard |
| ML Kit face detection | Exists (used in selfie) | Reuse in wizard |
| CameraX integration | Exists | Reuse in wizard |
| **NEW: Document request REST endpoint** | — | Build on DGEP + DGP |
| **NEW: WIA auth guard** | — | Build on DGEP + DGP |
| **NEW: Android wizard UI** | — | Replace onboarding |
| **NEW: Client-Attestation-PoP** | — | Build in Android app |
| **NEW: DGEP admin frontend** | — | Build Angular app |
| **NEW: DGP admin frontend** | — | Build Angular app |
| **NEW: document_requests table** | — | Migration on DGEP |
