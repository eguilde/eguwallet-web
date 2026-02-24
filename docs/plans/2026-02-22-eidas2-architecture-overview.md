# eIDAS 2.0 Architecture Overview — eguwallet Platform

> **Audit Date:** 2026-02-22
> **Auditor:** Claude Code
> **Scope:** All 6 eguwallet services vs. eIDAS 2.0, ARF v1.4+, ETSI TS 119 612, RFC 6960/5280/3161, OpenID4VCI, OpenID4VP, SD-JWT VC, DPoP (RFC 9449)

---

## Table of Contents

1. [Platform Overview](#1-platform-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Service-by-Service Audit Summary](#3-service-by-service-audit-summary)
   - [3.1 QTSP — PKI / Trust Service Provider](#31-qtsp--pki--trust-service-provider)
   - [3.2 LOTL — List of Trusted Lists](#32-lotl--list-of-trusted-lists)
   - [3.3 Certification — Conformity Assessment Body](#33-certification--conformity-assessment-body)
   - [3.4 Wallet Provider — EUDI Wallet Backend](#34-wallet-provider--eudi-wallet-backend)
   - [3.5 DGP — PID / Digital Government Passport Issuer](#35-dgp--pid--digital-government-passport-issuer)
   - [3.6 DGEP — Enhanced PID Issuer](#36-dgep--enhanced-pid-issuer)
4. [Cross-Service Compliance Matrix](#4-cross-service-compliance-matrix)
5. [Critical Architecture Gaps](#5-critical-architecture-gaps)
6. [New Feature: Certification Compliance Audit Service](#6-new-feature-certification-compliance-audit-service)
7. [Priority Remediation Roadmap](#7-priority-remediation-roadmap)

---

## 1. Platform Overview

The eguwallet platform is a **Romanian implementation of the EUDI Wallet ecosystem** under eIDAS 2.0. It consists of 6 independent microservices, each with its own subdomain, PostgreSQL database, Angular frontend, NestJS backend, and OIDC provider. Services communicate via NATS messaging (intra-platform) and will eventually use mTLS for cross-service API calls.

```
Platform: https://*.eguwallet.com
Deployment: Docker Compose on egucluster3.eguilde.cloud
Reverse Proxy: nginx on egucluster1 (wildcard SSL, static routing)
Database: Shared PostgreSQL on egucluster3 (separate DB per service)
Auth: oidc-provider v9 (per service), Authorization Code + PKCE, OTP-only login
```

### Service Ports

| Service         | Subdomain                      | Port  | DB Name              |
|-----------------|-------------------------------|-------|----------------------|
| QTSP            | qtsp.eguwallet.com            | 3001  | eguwallet_qtsp       |
| LOTL            | lotl.eguwallet.com            | 3002  | eguwallet_lotl       |
| Certification   | certification.eguwallet.com   | 3003  | eguwallet_cert       |
| Wallet Provider | wallet.eguwallet.com          | 3004  | eguwallet_wallet     |
| DGP             | dgp.eguwallet.com             | 3005  | eguwallet_dgp        |
| DGEP            | dgep.eguwallet.com            | 3006  | eguwallet_dgep       |

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         eIDAS 2.0 Ecosystem                         │
│                                                                     │
│  ┌─────────┐    ┌──────────┐   Certificate  ┌────────────────────┐ │
│  │  LOTL   │◄───│ QTSP     │◄───────────────│ Certification      │ │
│  │ (TSL)   │    │ (PKI/TSP)│                │ (CAB / Auditor)    │ │
│  └────┬────┘    └────┬─────┘                └────────┬───────────┘ │
│       │              │ Issues certs                   │ mTLS Probes │
│       │              │ Signs attestations             │ (planned)   │
│       ▼              ▼                                │             │
│  ┌────────────────────────────────────────────────────▼──────────┐ │
│  │                    Wallet Provider                             │ │
│  │  (WIA issuance, OpenID4VCI, Play Integrity, App Attest, DPoP)│ │
│  └────────────────────────────┬───────────────────────────────────┘ │
│                               │ WIA / OIDC                          │
│                     ┌─────────▼──────────┐                         │
│                     │   Android Wallet    │                         │
│                     │    (EUDI Wallet)    │                         │
│                     └─────────┬──────────┘                         │
│                               │ OpenID4VP / SD-JWT                  │
│              ┌────────────────▼───────────────────┐                │
│              │      PID / Passport Issuers         │                │
│              │  ┌──────────────┐  ┌─────────────┐│                │
│              │  │    DGP       │  │    DGEP     ││                │
│              │  │ (PID Issuer) │  │ (PID Issuer)││                │
│              │  └──────────────┘  └─────────────┘│                │
│              └────────────────────────────────────┘                │
└─────────────────────────────────────────────────────────────────────┘
```

### Trust Chain

```
EU Root LOTL (ec.europa.eu)
    └── Romanian LOTL (lotl.eguwallet.com) [eIDAS Art. 22]
            ├── QTSP (qtsp.eguwallet.com) [eIDAS Art. 20-24 QTSP]
            │       ├── CA Root → Intermediate CA → QES/QSeal/QWAC/QEDS leaf certs
            │       └── TSA, OCSP, CRL services
            ├── Wallet Provider (wallet.eguwallet.com) [ARF Art. 5a/6.1]
            │       └── WIA JWT (ES256, QTSP cert)
            ├── DGP (dgp.eguwallet.com) [eIDAS Art. 45a PID Provider]
            │       └── SD-JWT VC PID credentials
            └── DGEP (dgep.eguwallet.com) [eIDAS Art. 45a PID Provider]
                    └── SD-JWT VC / mdoc PID credentials
```

---

## 3. Service-by-Service Audit Summary

### 3.1 QTSP — PKI / Trust Service Provider

**Overall Score: 8.5/10 — GOOD**
**Subdomain:** qtsp.eguwallet.com
**Source:** `/c/dev/eguwallet-qtsp/`

#### What Works

| Feature | Standard | Status | Notes |
|---------|----------|--------|-------|
| OCSP responder | RFC 6960 | ✅ PASS | Full BasicOCSP with nonce, replay protection |
| CRL generation | RFC 5280 | ✅ PASS | Delta + full CRLs, CDP extensions |
| Timestamping (TSA) | RFC 3161 | ✅ PASS | SHA-256 + SHA-512 hash algorithms |
| Certificate types | eIDAS Annex | ✅ PASS | QES, QSeal, QWAC, QEDS with correct OIDs |
| CA hierarchy | eIDAS Art. 20 | ✅ PASS | Root → Intermediate → Leaf, separate CRL signing |
| eIDAS OID extensions | ETSI EN 319 412 | ✅ PASS | qcStatements, QcType, QcPDS, SSCD present |
| ACME protocol | RFC 8555 | ✅ PASS | Let's Encrypt compatible |
| LOTL registration | eIDAS Art. 22 | ✅ PASS | Self-registers to LOTL on startup |

#### Critical Gaps

| Gap | Impact | File:Line |
|-----|--------|-----------|
| **No HSM integration** — keys stored in PostgreSQL | eIDAS Art. 19(2), LoA High | `qtsp.service.ts:key-generation` |
| **No key rotation mechanism** — static keys forever | Security best practice | `qtsp.module.ts` |
| **Conformity assessment stubs** — `isCompliant()` returns hardcoded `true` | eIDAS Art. 20 | `conformity.service.ts` |
| **No ACME challenge rate limiting** | DDoS risk | `acme.controller.ts` |

#### Recommendations

1. **HSM Integration (Critical):** Replace DB-stored RSA/EC keys with Azure Key Vault, AWS CloudHSM, or SoftHSM2 adapter. The `KeyManagementService` should abstract the storage backend.
2. **Key Rotation:** Implement automated key rotation with 1-year intervals for leaf CAs, 5-year for intermediates. Publish new CRL before old key expires.
3. **Conformity Assessment:** Replace stubs with actual ETSI TS 119 403 CAB checks — certificate policy OID validation, key length enforcement, extension criticality checks.

---

### 3.2 LOTL — List of Trusted Lists

**Overall Score: 5.5/10 — PARTIAL COMPLIANCE**
**Subdomain:** lotl.eguwallet.com
**Source:** `/c/dev/eguwallet-lotl/`
**Standard:** ETSI TS 119 612 v2.2.1, eIDAS 2.0 Article 22

#### What Works

| Feature | Standard | Status | Notes |
|---------|----------|--------|-------|
| TSL XML structure | ETSI TS 119 612 §5.1-5.3 | ✅ PASS | Correct namespace, TSLTag, all SchemeInformation elements |
| Service type coverage | ETSI §5.4 | ✅ PASS | 15 service types incl. eIDAS 2.0 (WP, PID, QEAA, EAA) |
| Status lifecycle | ETSI §5.4 | ✅ PASS | All 15 ETSI statuses + granted/withdrawn/suspended |
| Sequence number increment | ETSI §5.3.3 | ✅ PASS | Auto-incremented on every status change |
| NextUpdate field | ETSI §5.3.10 | ✅ PASS | Configurable interval (default 24h) |
| JSON API for wallets | ARF §6.2 | ✅ PASS | GET /api/lotl with full service metadata |
| EU TSL sync (read) | eIDAS Art. 22 | ⚠️ PARTIAL | Reads EU TSLs to `eu_trust_lists` but no back-link |
| Database history schema | ETSI §5.5 | ⚠️ PARTIAL | Schema complete, but code never calls `createServiceHistory()` |

#### Critical Gaps

| Gap | Impact | File:Line |
|-----|--------|-----------|
| **Raw XMLDSig, NOT XAdES-BES** — no qualifying properties | ETSI TS 119 612 §6 — legally non-binding | `xml-signature.service.ts:67-150` |
| **Self-signed cert, not QSEAL** — legally cannot authenticate TSL | eIDAS Art. 32 | `xml-signature.service.ts:455-514` |
| **No PointersToOtherTSL** — EU LOTL cross-reference missing | ETSI §5.3.11, eIDAS Art. 22 | `xml-export.service.ts` |
| **Service history never created** — bug, code path exists but never called | ETSI §5.5 audit trail | `trusted-service.service.ts:1042-1063` |
| **No XSD schema validation** — may publish malformed XML | ETSI §5 correctness | `xml-export.service.ts:69-82` |
| **Custom C14N implementation** — may not match W3C spec | Signature invalidity risk | `xml-signature.service.ts:238-252` |
| **Missing ServiceInformationExtensions / Qualifications** | eIDAS 2.0 Art. 19 metadata | `xml-export.service.ts:254` |

#### Recommendations

1. **XAdES-BES Signature (Critical, 2 weeks):** Wrap `ds:Signature` in `xades:QualifyingProperties` with `xades:SignedProperties`, signing certificate reference, and TSA timestamp from QTSP.
2. **EU LOTL Pointer (1 day):** Add `PointersToOtherTSL` element in SchemeInformation pointing to `https://ec.europa.eu/tools/lotl/eu-lotl.xml`.
3. **Fix History Bug (2 hours):** Call `createServiceHistory()` in `updateServiceStatus()` — the database schema and code exist, just missing the invocation.
4. **XSD Validation (3 days):** Validate generated XML against ETSI schema before signing using `@xmldom/xmlschema`.

---

### 3.3 Certification — Conformity Assessment Body

**Overall Score: 6.0/10 — PARTIAL COMPLIANCE**
**Subdomain:** certification.eguwallet.com
**Source:** `/c/dev/eguwallet-certification/`
**Standard:** eIDAS Art. 20, ETSI TS 119 403, ISO/IEC 17065

#### What Works

| Feature | Standard | Status | Notes |
|---------|----------|--------|-------|
| 2-stage audit workflow | ISO/IEC 17065 §7.2 | ✅ PASS | Stage 1 (doc review) + Stage 2 (technical) |
| Non-conformity management | ISO/IEC 17065 §7.6 | ✅ PASS | Minor/Major/Critical NC classification |
| Certification issuance | eIDAS Art. 20 | ✅ PASS | Certificate + token issued on approval |
| Certificate number scheme | ETSI TS 119 403 | ✅ PASS | CERT-YYYY-NNNNN format |
| Wallet provider certification | ARF Art. 5c | ✅ PASS | Full workflow for wallet provider certs |
| LOTL integration | eIDAS Art. 22 | ✅ PASS | Registers certified services to LOTL |

#### Critical Gaps

| Gap | Impact | File:Line |
|-----|--------|-----------|
| **Audit logs NOT cryptographically signed** — no hash chain | eIDAS Art. 20, forensic evidence | `audit-log.service.ts` |
| **No mTLS probe capability** — audits are manual only | eIDAS Art. 20 continuous monitoring | Missing entirely |
| **No formal report generation** — no PDF/XML report output | ISO/IEC 17065 §7.7 | `audit.service.ts` |
| **No surveillance audits** — post-certification monitoring absent | ISO/IEC 17065 §7.8 | Missing entirely |
| **No standardized mTLS conformance probes** | eIDAS Art. 20(1) technical assessment | Missing entirely |

#### New Requirements (From Design)

The Certification service must gain a **Compliance Audit Service** that:
- Connects via mTLS to every registered service (QTSP, LOTL, DGP, DGEP, Wallet Provider)
- Runs standardized conformance probes periodically (configurable schedule)
- Stores a cryptographically signed audit log (SHA-256 hash chain)
- Exposes results in the Certification Angular UI with drill-down per service
- Allows manual trigger of audits from the UI

See Section 6 for the full design of this new component.

---

### 3.4 Wallet Provider — EUDI Wallet Backend

**Overall Score: 7.5/10 — SUBSTANTIALLY COMPLIANT**
**Subdomain:** wallet.eguwallet.com
**Source:** `/c/dev/eguwallet-wallet-provider/`
**Standard:** eIDAS 2.0 ARF v1.4+, ISO/IEC 18013-5

#### What Works

| Feature | ARF Section | Status | Notes |
|---------|-------------|--------|-------|
| Wallet Instance Attestation (WIA) | ARF 6.2.1 | ✅ PASS | JWT + ES256 + QTSP cert, 5 security levels |
| OpenID4VP presentation | ARF 6.3.2 | ✅ PASS | DCQL + presentation_definition, direct_post |
| DPoP (RFC 9449) | ARF 6.2.3 | ✅ PASS | Full RFC 9449, token binding, jti replay prevention |
| Play Integrity (Android) | ARF 6.1 | ✅ PASS | Server-side Google API, nonce validation, verdicts |
| Apple App Attest (iOS) | ARF 6.1 | ✅ PASS | CBOR decode, Apple CA chain, counter replay |
| WSCD/WSCA interfaces | ARF 6.1.1-6.1.2 | ✅ PASS | Full interface defined, software implementation |
| Wallet lifecycle | ARF 7.1.2 | ✅ PASS | CREATED→OPERATIONAL→SUSPENDED→REVOKED |
| Well-known endpoints | OpenID4VCI | ✅ PASS | credential_issuer, jwks_uri, token_endpoint |
| 4-phase bootstrap | ARF 6.2 | ✅ PASS | QTSP cert → Certification → LOTL → DB |

#### Critical Gaps

| Gap | Impact | File:Line |
|-----|--------|-----------|
| **Android key attestation chain NOT verified** — stored but never validated | ARF 6.1.4 device binding proof | `wallet.service.ts:61-75` |
| **No hardware WSCD implementations** — software only | ARF 6.1.3 LoA High | `wallet-unit/wscd.interface.ts` (stub) |
| **DPoP nonces in-memory** — not persistent, multi-instance unsafe | RFC 9449 replay prevention | `dpop.service.ts:18-20` |
| **OpenID4VCI incomplete** — no deferred credential, no batch | OpenID4VCI §8-9 | `wallet.controller.ts:886-953` |

#### Recommendations

1. **Android Key Attestation Verification:** Decode DER chain, verify against Google Hardware Attestation Root CA, parse OID 1.3.6.1.4.1.11129.2.1.17 extension for device properties.
2. **Hardware WSCD:** Add Azure Key Vault adapter (already referenced in code). Even a TPM-backed software module improves LoA from Low to Substantial.
3. **Persist DPoP Nonces:** Move `Map<string, nonce>` to PostgreSQL `dpop_nonces` table with TTL-based cleanup.

---

### 3.5 DGP — PID / Digital Government Passport Issuer

**Overall Score: 6.5/10 — PARTIALLY COMPLIANT**
**Subdomain:** dgp.eguwallet.com
**Source:** `/c/dev/eguwallet-dgp/`
**Standard:** eIDAS 2.0 Art. 5a, ARF PID Rulebook, OpenID4VCI, SD-JWT VC

#### What Works

| Feature | Standard | Status | Notes |
|---------|----------|--------|-------|
| SD-JWT VC credential format | ARF PID Rulebook | ✅ PASS | `dc+sd-jwt` format, correct `vct` claim |
| Selective disclosure | SD-JWT spec | ✅ PASS | All PID attributes selectively disclosable |
| KB-JWT (holder binding) | ARF LoA High | ✅ PASS | Required, throws on absence |
| DPoP token binding | RFC 9449 | ✅ PASS | Access token binding via `ath` claim |
| QTSP certificate integration | eIDAS Art. 32 | ✅ PASS | Uses QTSP-issued QSEAL for signing |
| LOTL registration | eIDAS Art. 22 | ✅ PASS | Registers as PID_PROV on startup |
| OpenID4VCI metadata | OpenID4VCI §10 | ✅ PASS | credential_issuer, credential_endpoint, jwks_uri |
| SD-JWT expiry check | ARF §6.6 | ✅ PASS | Rejects expired credentials |

#### Critical Gaps

| Gap | Impact | File:Line |
|-----|--------|-----------|
| **No auth guards on admin endpoints** (approve/reject/revoke) | Any user can approve passports | `admin.controller.ts` |
| **Citizen photos stored unencrypted** in PostgreSQL BYTEA | GDPR Art. 32, eIDAS LoA High | `passport-request.entity.ts` |
| **No WORM audit log** — status changes not immutably logged | eIDAS Art. 20, GDPR Art. 30 | `passport.service.ts` |
| **No mdoc format** — only SD-JWT VC | ARF mandatory mdoc support | Missing entirely |
| **No consent tracking** — user consent for each disclosure not stored | GDPR Art. 7 | Missing entirely |
| **No mTLS client verification** on issuance endpoint | eIDAS Art. 19 secure channel | `credential.controller.ts` |

#### PID Attribute Compliance (eIDAS Art. 5a Annex VI)

| Attribute | Required | Implemented | Note |
|-----------|----------|-------------|------|
| family_name | ✅ | ✅ | |
| given_name | ✅ | ✅ | |
| birth_date | ✅ | ✅ | |
| age_over_18 | ✅ | ✅ | |
| issuing_country | ✅ | ✅ | Hardcoded 'RO' |
| issuing_authority | ✅ | ✅ | |
| document_number | ✅ | ✅ | |
| expiry_date | ✅ | ✅ | |
| portrait | Optional | ✅ | |
| address | Optional | ⚠️ | Partial — no structured address |
| nationality | Optional | ⚠️ | Present but not disclosed selectively |

---

### 3.6 DGEP — Enhanced PID Issuer

**Overall Score: 7.5/10 — SUBSTANTIALLY COMPLIANT** *(revised upward after comprehensive audit)*
**Subdomain:** dgep.eguwallet.com
**Source:** `/c/dev/eguwallet-dgep/`
**Standard:** eIDAS 2.0 Art. 5a/45a, ARF PID Rulebook, OpenID4VCI, SD-JWT VC, ISO 18013-5

> Note: A comprehensive second audit revealed DGEP is significantly more capable than initially assessed. The service has production-quality implementations of SD-JWT, mdoc, DPoP, status lists, and QTSP/LOTL bootstrap — it is architecturally superior to DGP.

#### What Works

| Feature | Standard | Status | Notes |
|---------|----------|--------|-------|
| SD-JWT VC (`dc+sd-jwt`) | ARF PID Rulebook | ✅ 98/100 | 16-byte salts, SHA-256, pseudonymous sub (HMAC) |
| ISO 18013-5 mdoc | ARF proximity | ✅ 97/100 | 807-line service, CBOR, COSE_Sign1, device binding |
| DPoP (RFC 9449) | RFC 9449 | ✅ 99/100 | DB-based replay prevention, ath binding, jkt cnf |
| Status list (RFC 9102) | ARF revocation | ✅ 98/100 | Bitstring, gzip, full JWT signing, revocation |
| PID attributes (Art. 5a) | eIDAS Annex VI | ✅ 95/100 | All mandatory + structured address, age_over_* |
| Pre-authorization flow | OpenID4VCI | ✅ 96/100 | 32-byte code, 6-digit TX code, one-time use |
| QTSP/LOTL bootstrap | eIDAS Art. 22/45a | ✅ 96/100 | 4-phase: key→QTSP cert→certification→LOTL reg |
| Identity verification | eIDAS LoA High | ✅ 88/100 | AWS Rekognition (face match 80%) + Textract OCR |
| Batch + deferred issuance | OpenID4VCI §8-9 | ⚠️ 75/100 | Service + DB schema exists, endpoint missing |
| Well-known metadata | OpenID4VCI §10 | ✅ PASS | Bilingual display (EN/RO), complete metadata |

#### Critical Gaps

| Gap | Impact | File:Line |
|-----|--------|-----------|
| **No auth on /revoke and /unrevoke endpoints** (OidcModule regression) | Anyone can revoke credentials | `status.controller.ts:38-56` |
| **No auth on GET /pid-requests** | Anyone can list all PID requests | `pid-request.controller.ts:170-173` |
| **mdoc format blocked in controller** — 1-line fix, service fully supports it | mdoc issuance unavailable | `credential.controller.ts:29` |
| **Missing deferred credential endpoint** — service + DB exist, controller absent | OpenID4VCI §8 non-conformant | Missing `deferred-credential.controller.ts` |
| **x5c certificate chain missing from JWKS** | Chain validation impossible for verifiers | `well-known.controller.ts:188-194` |
| **mTLS `rejectUnauthorized: false`** — cert validation disabled | MITM risk on identity verification calls | `verification-client.service.ts:91` |
| **Pseudonym uses issuer URL as HMAC key** — unstable on redeploy | Subject IDs break on URL change | `sd-jwt.service.ts:383-399` |
| **No OCSP/CRL revocation check** — TODO in code | Trust chain not validated | `trust-chain.service.ts:276` |
| **LOTL cache no max stale age** | Trust decisions on arbitrarily stale data | `trust-chain.service.ts:442-449` |
| **No audit logging in credential flow** — service exists but never called | No forensic trail | `credential-issuance.service.ts:185-196` |

#### OidcModule Refactor Regression

Before the refactor, DGEP had explicit `BearerTokenGuard` + `RolesGuard` on admin endpoints. The refactor removed these without adding OIDC-based guards. All admin operations are currently unprotected.

**Fix required:** Add `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')` to status, pid-request, and portal-pid-issuer controllers.

#### DGEP vs DGP Comparison

| Aspect | DGP | DGEP |
|--------|-----|------|
| Admin auth | ❌ Missing | ❌ Missing (regression) |
| DPoP implementation | ✅ (in-memory nonces) | ✅ **Better** (DB-based replay prevention) |
| SD-JWT format | ✅ | ✅ |
| mdoc (ISO 18013-5) | ❌ | ✅ **Full 807-line service** (blocked by 1-line controller bug) |
| Status list (RFC 9102) | ❌ | ✅ |
| Batch/deferred issuance | ❌ | ⚠️ Partial (missing endpoint) |
| QTSP/LOTL bootstrap | ✅ | ✅ **Better** (4-phase, retry, monitoring) |
| Identity verification | ✅ Manual | ✅ AWS Rekognition + Textract |
| Audit logging | ❌ | ❌ (service exists, not called) |
| Pseudonym stability | ✅ | ⚠️ Fragile (URL-based key) |

---

## 4. Cross-Service Compliance Matrix

### eIDAS 2.0 Article Compliance

| eIDAS 2.0 Requirement | QTSP | LOTL | Cert | WP | DGP | DGEP |
|-----------------------|------|------|------|----|-----|------|
| **Art. 5a** — PID attributes | N/A | N/A | N/A | N/A | ✅ | ✅ |
| **Art. 5a** — Holder binding (KB-JWT) | N/A | N/A | N/A | N/A | ✅ | ❌ |
| **Art. 5c** — Wallet certification | N/A | N/A | ✅ | ✅ | N/A | N/A |
| **Art. 6a** — Wallet instance attestation | N/A | N/A | N/A | ✅ | N/A | N/A |
| **Art. 19(2)** — Key protection | ❌ DB | N/A | N/A | ⚠️ SW | N/A | N/A |
| **Art. 20** — QTSP supervision | ✅ | N/A | ✅ CAB | N/A | N/A | N/A |
| **Art. 22** — Trust list publication | N/A | ⚠️ | ✅ | N/A | N/A | N/A |
| **Art. 22** — Trust list signature (XAdES) | N/A | ❌ | N/A | N/A | N/A | N/A |
| **Art. 32** — QSEAL for trust services | ✅ issues | ❌ self-signed | N/A | N/A | ✅ | ✅ |
| **Art. 45a** — PID Provider registration | N/A | ✅ reg. | N/A | N/A | ✅ | ✅ |
| **GDPR Art. 32** — Encryption at rest | ❌ | ❌ | ❌ | ⚠️ | ❌ | ❌ |

Legend: ✅ Pass, ⚠️ Partial, ❌ Fail, ❓ Unknown (audit pending), N/A Not applicable

### Protocol Compliance

| Protocol | QTSP | LOTL | Cert | WP | DGP | DGEP |
|----------|------|------|------|----|-----|------|
| OpenID4VCI | N/A | N/A | N/A | ⚠️ | ✅ | ✅ |
| OpenID4VP | N/A | N/A | N/A | ✅ | N/A | N/A |
| SD-JWT VC (dc+sd-jwt) | N/A | N/A | N/A | N/A | ✅ | ✅ |
| mdoc (ISO 18013-5) | N/A | N/A | N/A | ⚠️ | ❌ | ✅ (blocked by 1-line bug) |
| DPoP (RFC 9449) | N/A | N/A | N/A | ✅ | ✅ | ✅ |
| PKCE (RFC 7636) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| OTP-only auth | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| ETSI XAdES-BES | N/A | ❌ | N/A | N/A | N/A | N/A |
| ETSI TS 119 612 | N/A | ⚠️ | N/A | N/A | N/A | N/A |
| RFC 6960 (OCSP) | ✅ | N/A | N/A | N/A | N/A | N/A |
| RFC 3161 (TSA) | ✅ | N/A | N/A | N/A | N/A | N/A |

---

## 5. Critical Architecture Gaps

### P0 — Security Vulnerabilities (Fix Immediately)

1. **DGP/DGEP Admin Endpoints Unauthenticated**
   - **Issue:** Approve, reject, revoke passport requests accessible without auth guards
   - **Impact:** Any user can approve their own passport application or revoke any citizen's credentials
   - **DGP fix:** Add `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('admin')` to `admin.controller.ts`
   - **DGEP fix (regression):** Add guards to `status.controller.ts:38-56`, `pid-request.controller.ts:170`, `portal-pid-issuer.controller.ts:132`
   - **Estimated effort:** 4 hours (both services)

2. **LOTL Service History Bug**
   - **Issue:** `createServiceHistory()` method exists but is never called from `updateServiceStatus()`
   - **Impact:** Zero audit trail for trust status changes — violates ETSI TS 119 612 §5.5
   - **Fix:** Add `await this.createServiceHistory(...)` call in `trusted-service.service.ts:updateServiceStatus`
   - **Estimated effort:** 2 hours

3. **DPoP Nonces In-Memory Only**
   - **Issue:** `dpop.service.ts` uses `Map<string, nonce>` — lost on restart, unsafe in multi-replica
   - **Impact:** Potential DPoP replay attacks after service restart
   - **Fix:** Persist nonces to PostgreSQL `dpop_nonces` table with TTL cleanup
   - **Estimated effort:** 4 hours

### P1 — Compliance Blockers (Required Before Production)

4. **LOTL XAdES-BES Signature**
   - **Issue:** Raw XMLDSig, not ETSI XAdES — trust list is legally non-binding
   - **Fix:** Add `xades:QualifyingProperties` wrapper + TSA timestamp from QTSP
   - **Estimated effort:** 2 weeks

5. **LOTL Missing EU LOTL Pointer**
   - **Issue:** No `PointersToOtherTSL` element pointing to EU LOTL
   - **Fix:** Add static element in `xml-export.service.ts` SchemeInformation section
   - **Estimated effort:** 1 day

6. **QTSP No HSM Integration**
   - **Issue:** All cryptographic keys stored in PostgreSQL as PEM strings
   - **Fix:** Azure Key Vault or SoftHSM2 adapter behind `KeyStorageInterface`
   - **Estimated effort:** 1–2 weeks

7. **DGP/DGEP Missing mdoc Format**
   - **Issue:** Only SD-JWT VC issued; ARF mandates mdoc (ISO 18013-5) for proximity flows
   - **Fix:** Implement CBOR-encoded COSE_Sign1 mdoc issuance for both services
   - **Estimated effort:** 3 weeks

### P2 — Important Improvements

8. **Citizen Photo Encryption (DGP/DGEP)**
   - Encrypt photo BLOBs with AES-256-GCM before PostgreSQL storage
   - Key managed via QTSP KeyManagementService

9. **Wallet Provider Android Key Attestation Verification**
   - Decode DER certificate chain, verify against Google Hardware Attestation Root CA
   - Extract and store attestation extension claims for security scoring

10. **LOTL XSD Schema Validation**
    - Validate generated XML before signing using ETSI TS 119 612 XSD
    - Reject invalid XML before publishing

11. **Consent Tracking (DGP/DGEP)**
    - Store per-disclosure consent in `credential_disclosures` table
    - Expose consent history in citizen portal

---

## 6. New Feature: Certification Compliance Audit Service

### Overview

The Certification service shall gain a new **Compliance Audit Service** subsystem that:
- Connects via **mTLS** to all 5 other services' `/compliance` endpoints
- Runs **standardized conformance probe suites** periodically
- Stores a **cryptographically signed audit log** (SHA-256 hash chain, no tampering possible)
- Exposes **audit results in the Certification Angular UI** with per-service drill-down
- Allows **manual trigger** of audits from the UI

### Architecture

```
Certification Service
├── ComplianceAuditService (NestJS service)
│   ├── MtlsProbeService — executes probes against each service
│   ├── AuditChainService — SHA-256 hash chain log
│   ├── ReportGeneratorService — PDF/JSON formal reports
│   └── SchedulerService — cron-based periodic audit triggers
│
├── REST API (admin-only)
│   ├── POST /api/compliance/audit/:serviceId — manual trigger
│   ├── GET /api/compliance/audit/:auditId — audit result
│   ├── GET /api/compliance/audits — paginated list
│   └── GET /api/compliance/report/:auditId — formal PDF report
│
└── Angular UI additions
    ├── /admin/compliance — service overview dashboard
    ├── /admin/compliance/:serviceId — service audit history
    └── /admin/compliance/audit/:auditId — drill-down with findings
```

### mTLS Endpoints (Each Service Must Expose)

Each of the 5 services must implement a `GET /compliance/probe` endpoint:

```typescript
// Response format (all services)
interface ComplianceProbeResponse {
  service: string;
  version: string;
  timestamp: string;
  probes: ProbeResult[];
}

interface ProbeResult {
  probeId: string;               // e.g. "OIDC_DISCOVERY"
  standard: string;              // e.g. "RFC 8414"
  description: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIP';
  evidence?: string;             // URL, hash, or extracted value
  findings?: string;             // What was wrong
}
```

### Probe Suites Per Service

**QTSP Probes:**
- `OCSP_RESPONSE_VALID` — fetch OCSP for a test certificate, verify BasicOCSP response
- `CRL_SIGNED_VALID` — fetch CRL, verify signature and currency
- `TSA_TIMESTAMP_VALID` — request timestamp token, verify RFC 3161 response
- `CERT_OID_QSEAL` — verify issued cert contains correct eIDAS QSeal OIDs
- `ACME_DIRECTORY_REACHABLE` — fetch ACME directory JSON
- `JWKS_ENDPOINT_REACHABLE` — fetch JWKS, verify at least 1 RS256 key

**LOTL Probes:**
- `TSL_XML_PARSEABLE` — fetch /lotl.xml, parse with ETSI schema
- `TSL_SIGNATURE_PRESENT` — verify Signature element present
- `TSL_SEQUENCE_INCREASING` — compare sequence numbers across runs
- `TSL_NEXT_UPDATE_FUTURE` — verify NextUpdate > now
- `TSL_EU_POINTER_PRESENT` — verify PointersToOtherTSL to ec.europa.eu
- `TRUSTED_SERVICES_NONEMPTY` — verify at least 1 active service

**Wallet Provider Probes:**
- `WIA_ENDPOINT_REACHABLE` — fetch /.well-known/openid-credential-issuer
- `JWKS_ENDPOINT_REACHABLE` — fetch /.well-known/jwks
- `DPOP_NONCE_ENDPOINT` — verify /api/dpop/nonce returns valid nonce
- `ATTESTATION_LEVEL_SCHEMA` — verify WIA JWT contains required ARF claims

**DGP / DGEP Probes:**
- `CREDENTIAL_ISSUER_METADATA` — fetch /.well-known/openid-credential-issuer
- `TOKEN_ENDPOINT_PRESENT` — verify token_endpoint in metadata
- `CREDENTIAL_ENDPOINT_PRESENT` — verify credential_endpoint in metadata
- `JWKS_ENDPOINT_REACHABLE` — fetch JWKS
- `PID_FORMAT_DC_SD_JWT` — verify credential_configurations_supported includes `dc+sd-jwt`
- `LOTL_REGISTRATION_ACTIVE` — verify service registered in LOTL as PID_PROV

### Audit Hash Chain

```sql
-- Table: compliance_audit_logs
CREATE TABLE compliance_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_number BIGSERIAL UNIQUE NOT NULL,  -- Monotonic counter
  audit_id UUID NOT NULL,                      -- Links to parent audit run
  service_id UUID REFERENCES trusted_services(id),
  service_name VARCHAR(100) NOT NULL,
  probe_id VARCHAR(100) NOT NULL,
  standard VARCHAR(200),
  status VARCHAR(20) NOT NULL,                 -- PASS/FAIL/WARN/SKIP
  evidence TEXT,
  findings TEXT,
  audited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  previous_hash VARCHAR(64) NOT NULL,          -- SHA-256 of previous log entry
  entry_hash VARCHAR(64) NOT NULL,             -- SHA-256 of this entry + previous_hash
  triggered_by VARCHAR(200)                    -- 'scheduler' or admin user email
);
```

Each log entry's `entry_hash = SHA256(sequence_number || previous_hash || service_name || probe_id || status || findings || audited_at)`. Any tampering invalidates the chain from that point forward.

### Formal Report Format

Reports are generated as structured JSON (exportable to PDF via frontend) containing:
- Executive summary (pass/fail counts, overall score)
- Per-probe findings with file:line evidence
- Non-conformity list with severity
- Certification recommendation (approve/deny/conditional)
- Digital signature by Certification service key (QTSP-issued certificate)

---

## 7. Priority Remediation Roadmap

### Week 1 — Security Fixes (P0)

| Task | Service | Effort |
|------|---------|--------|
| Add auth guards to admin endpoints | DGP, DGEP | 4h |
| Fix LOTL service history bug | LOTL | 2h |
| Persist DPoP nonces to DB | WP | 4h |
| DGEP regression audit & fix OidcModule integration | DGEP | 1–2d |

### Week 2 — Compliance Fixes (P1)

| Task | Service | Effort |
|------|---------|--------|
| Add EU LOTL PointersToOtherTSL | LOTL | 1d |
| LOTL XSD validation before publish | LOTL | 3d |
| Encrypt citizen photos at rest | DGP, DGEP | 2d |
| WORM audit log for passport operations | DGP, DGEP | 2d |

### Weeks 3–4 — Major Features (P1)

| Task | Service | Effort |
|------|---------|--------|
| LOTL XAdES-BES signature wrapping + TSA timestamp | LOTL | 2 weeks |
| Android Key Attestation chain verification | WP | 1 week |
| Certification: mTLS probe service (Phase 1) | Cert | 2 weeks |

### Month 2 — Strategic Improvements (P2)

| Task | Service | Effort |
|------|---------|--------|
| QTSP HSM integration (SoftHSM2 first, Azure Key Vault later) | QTSP | 2 weeks |
| mdoc (ISO 18013-5) credential format | DGP, DGEP | 3 weeks |
| Consent tracking for credential disclosures | DGP, DGEP | 1 week |
| Certification: full compliance audit UI + hash chain | Cert | 3 weeks |
| QTSP key rotation automation | QTSP | 1 week |

---

---

## Appendix: DGEP Comprehensive Audit Findings

From a deep audit of 20 source files + 1 SQL schema (2026-02-22):

### DGEP Architecture Strengths (Better Than DGP)

1. **ISO 18013-5 mdoc fully implemented** (`mdoc.service.ts`, 807 lines): Complete CBOR encoding, COSE_Sign1 with `ieee-p1363` signature format, MSO with value digests, device authentication (both COSE_Sign1 and COSE_Mac0). Only blocker: controller `credential.controller.ts:29` validates `'dc+sd-jwt' | 'vc+sd-jwt'` — adding `'mso_mdoc'` unblocks it.

2. **DPoP uses PostgreSQL for replay prevention** (`dpop.service.ts:64-71`): Stores `jti` in `cnonces` table with `expires_at`. Safe across restarts and multiple instances.

3. **RFC 9102 Status List fully implemented** (`status-list.service.ts`): Bitstring with gzip compression, proper bit indexing, signed `statuslist+jwt`, auto-rotation when full.

4. **4-phase QTSP/LOTL bootstrap** (`pid-provider-bootstrap.service.ts`): EC P-256 key → QTSP certificate → Certification token → LOTL registration. 10-retry with 60s intervals, daily status monitoring, self-signed fallback for offline operation.

5. **AWS Identity Verification** (`verification-client.service.ts`): Textract OCR for ID card extraction, Rekognition face comparison (80% threshold), optional liveness detection.

6. **CNP Validation** (`cnp-validator.service.ts`): Proper weighted checksum algorithm, county code validation, century-aware birth year extraction.

### Remaining Issues

| Issue | Severity | Fix |
|-------|----------|-----|
| Admin endpoints unauthenticated (regression) | CRITICAL | Add `@UseGuards` to 3 controllers |
| mdoc blocked in credential controller | HIGH | 1-line type change at `credential.controller.ts:29` |
| Missing deferred credential endpoint | HIGH | Add `deferred-credential.controller.ts` |
| x5c chain missing from JWKS | HIGH | Add `x5c` field in `well-known.controller.ts:188` |
| `rejectUnauthorized: false` in mTLS | HIGH | Set to `process.env.NODE_ENV !== 'development'` |
| Pseudonym uses issuer URL as HMAC key | MEDIUM | Use stable `ISSUER_SEED` env var |
| No OCSP/CRL checking | MEDIUM | Implement or delegate to Certification service |
| LOTL cache no max-age grace period | MEDIUM | Add `LOTL_GRACE_HOURS` check |
| Audit logging not called in issuance | MEDIUM | Call `this.auditService.log()` after issuance |
| Accepts deprecated `vc+sd-jwt` | LOW | Reject with clear error message |

*Revised score: 7.5/10 — SUBSTANTIALLY COMPLIANT. The admin auth regression is the primary blocker for production.*
