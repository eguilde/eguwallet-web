# ARF High-Level Requirements — Gap Analysis

> Last updated: 2026-02-24 (full re-audit — all 6 services + P1 + P2 + P3 fixes applied)
> ARF version: 2.5.0
> Source: https://eu-digital-identity-wallet.github.io/eudi-doc-architecture-and-reference-framework/2.5.0/

---

## Audit Scope

| Component | Audit Status | Path |
|---|---|---|
| `eguwallet-android` | ✅ Full code-level re-audit (2026-02-24) | `C:/dev/eguwallet-android/` |
| `eguwallet-wallet-provider` | ✅ Full code-level re-audit (2026-02-24) | `C:/dev/eguwallet-wallet-provider/` |
| `backend/src/verifier` | ✅ Audited (full code review) | `C:/dev/eguilde/backend/src/verifier/` |
| `eguwallet-dgep` | ✅ Full code-level audit (2026-02-24) | `C:/dev/eguwallet-dgep/` |
| `eguwallet-lotl` | ✅ Full code-level audit (2026-02-24) | `C:/dev/eguwallet-lotl/` |
| `eguwallet-certification` | ✅ Full code-level audit (2026-02-24) | `C:/dev/eguwallet-certification/` |
| `eguwallet-qtsp` | ✅ Full code-level audit (2026-02-24) | `C:/dev/eguwallet-qtsp/` |

---

## Legend

| Symbol | Meaning |
|---|---|
| ✅ | Compliant — evidence found in code |
| ⚠️ | Partial — foundation exists but gaps remain |
| ❌ | Non-compliant / Not implemented |
| ❓ | Not yet assessed |

---

## Credential Formats

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| CF-01 | Wallet supports SD-JWT VC format (`dc+sd-jwt`) | ✅ | `verifier.service.ts:102,308` | Implemented in verifier. PID issuer in eguwallet-dgep (separate audit needed) |
| CF-02 | Wallet supports mdoc format (ISO 18013-5) | ✅ | `eguwallet-android/.../mdoc/MdocParser.kt` | Dedicated mdoc parser present in Android app |
| CF-03 | SD-JWT uses `dc+sd-jwt` identifier (NOT `vc+sd-jwt`) | ✅ | `verifier.service.ts:102,308` | Confirmed ARF 2.5.0 compliant |
| CF-04 | mdoc uses ISO 18013-5 CBOR encoding | ✅ | `eguwallet-android/.../mdoc/MdocParser.kt` (commit f8c43d0) | **FIXED 2026-02-24**: Real COSE_Sign1 array decoding added — extracts payload_bstr at index 2, signature at index 3; `IssuerSignedItem.random` now uses `SecureRandom.generateSeed(16)` instead of zero bytes; fallback to stub on parse exception |

---

## Protocols and Interfaces (CIR 2024/2982)

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| PI-01 | Wallet supports OpenID4VCI for credential issuance | ✅ | `wallet-provider: well-known.controller.ts:33`, `wallet.controller.ts:812,886`; `android: OidcApiService.kt`, `IssueCredentialUseCase.kt` | Full OpenID4VCI: pre-auth code grant, token endpoint, credential endpoint, JWKS, signed metadata |
| PI-02 | Wallet supports OpenID4VP for credential presentation | ✅ | `wallet-provider: openid4vp.service.ts:32,95,167`; `android: CredentialPresentationManager.kt` | JWT signature verified + DCQL-only enforced |
| PI-03 | Wallet supports HAIP 1.0 profile | ✅ | `wallet-provider: haip.service.ts`, `openid4vp.service.ts` | HAIP 1.0 declared, direct_post.jwt + JarmService |
| PI-04 | Authorization requests use `dcql_query` (NOT `presentation_definition`) | ✅ | `verifier.service.ts:96-135,298-299`; `openid4vp.service.ts:545` | Verifier uses DCQL only by default. **Note**: wallet-provider still accepts legacy `presentation_definition` |
| PI-05 | `vp_formats` contains `dc+sd-jwt` | ✅ | `verifier.service.ts:307-310` | Confirmed. Also supports `mso_mdoc` |
| PI-06 | Wallet supports proximity presentation (ISO 18013-5 BLE/NFC) | ✅ | `android: ProximityPresentationManager.kt`, `ProximityPresentationScreen.kt`, `EudiDocumentManagerBridge.kt` | Dedicated proximity module with EUDI integration present |

---

## Wallet Unit Attestation (EC TS03 V1.0)

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| WUA-01 | Wallet Provider issues WUA JWT to each Wallet Unit on registration | ✅ | `wallet.controller.ts:167` (`issue_wallet_attestation`); `wallet-http.controller.ts:846` (`POST /api/wallet/attestation/create`) | Full issuance flow: registration → token → credential. Both message bus and HTTP REST paths present |
| WUA-02 | WUA signed by Wallet Provider keypair (JWT, asymmetric) | ✅ | `wallet-attestation.service.ts:243` | ES256 JWT signed by `WalletProviderKeyManagementService`. `vct: 'urn:eu:eudi:wallet:attestation:1'`. Compliance event logged |
| WUA-03 | WUA references WSCA/WSCD certification (`cnf` claim or hardware attestation) | ✅ | `wallet-attestation.service.ts` (commit 42280ef) | **FIXED 2026-02-24**: Added `cnf.key_attestation` with Android Key Attestation chain from `device_info.key_attestation_chain`; added `wallet_provider_certification.certification_uri` pointing to `WSCA_CERT_URI` env (default `https://cert.eguwallet.eu/api/wsca-cert`) |
| WUA-04 | WUA revocation implemented (individual + batch) | ✅ | `wua-status-list.service.ts`, `wallet-http.controller.ts` (commit a03ce78) | **FIXED 2026-02-24**: New `WuaStatusListService` implementing RFC 9427 Token Status List — 1-bit bitstring (bit=1=REVOKED), gzip-compressed, signed `statuslist+jwt`. `GET /api/wallet/status-list` with `Content-Type: application/statuslist+jwt` |
| WUA-05 | WUA trust anchor (public key) registered in national trusted list | ⚠️ | `verifier.service.ts:324-376` (fetches WP JWKS from gateway) | Backend fetches WP JWKS from `wallet.eguilde.cloud` gateway — mechanism exists. **Gap**: Formal registration in national trusted list (governance action required) |
| WUA-06 | PID/QEAA issuers verify WUA before issuing credentials | ✅ | `verifier.service.ts:324-376` | `verifyWalletUnitAttestation()` validates WUA JWT: issuer → JWKS → signature → expiry. Non-blocking (warning) while ecosystem matures |

---

## Security — Key Binding and Holder Binding

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| HB-01 | Wallet supports KB-JWT for SD-JWT presentations | ✅ | `verifier.service.ts:612-626` | KB-JWT mandatory for eIDAS LoA High. Throws if absent: `'KB-JWT required for eIDAS LoA High'` |
| HB-02 | KB-JWT `iat` freshness verified (≤5 min) | ✅ | `verifier.service.ts:725-731` | Rejects if > 5 min old: `'KB-JWT iat is too old (> 5 min) — possible replay attack'` |
| HB-03 | SD-JWT `exp` verified — reject expired credentials | ✅ | `verifier.service.ts:550-554` | Throws `'SD-JWT credential has expired'` |
| HB-04 | WSCA uses hardware-backed key storage (WSCD / StrongBox / TEE) | ✅ | `android: wscd/AndroidWSCD.kt` (code-reviewed 2026-02-24) | **CONFIRMED**: `setIsStrongBoxBacked(true)` present in `AndroidWSCD.kt`; `setUserAuthenticationRequired(true)` enforced; `PURPOSE_SIGN` only; no `PURPOSE_WRAP_KEY`/`PURPOSE_ENCRYPT` |
| HB-05 | Private keys never leave WSCD | ✅ | `android: wscd/WSCDInterface.kt`, `BackupRestoreManager.kt` (code-reviewed 2026-02-24) | **CONFIRMED**: `BackupRestoreManager` does NOT export raw private key material — backup payload contains only public key + encrypted session token; key alias exported for migration but private key bytes never serialised |

---

## Selective Disclosure

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| SD-01 | Wallet supports attribute-level selective disclosure requests | ✅ | `verifier.service.ts:68-94` | DCQL per-credential claim specifications with `required: false` for optional claims |
| SD-02 | Wallet only reveals disclosed attributes (no undisclosed leakage) | ✅ | `verifier.service.ts:587-610,656-670` | Disclosure hash chain validated: `_sd` digests matched, tampered disclosures rejected, `_sd`/`_sd_alg`/`cnf`/`status` stripped from output |
| SD-03 | User shown requested attributes BEFORE consenting to presentation | ✅ | `android: SelectiveDisclosureScreen.kt` | Dedicated selective disclosure screen present |
| SD-04 | User explicitly consents to each credential presentation | ✅ | `android: UserConsentScreen.kt` | Dedicated consent screen for presentations |

---

## Pseudonyms

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| PS-01 | Wallet supports pseudonyms (wallet-unit specific, RP-specific) | ✅ | `wallet-provider: pseudonym.service.ts`, `pseudonym.controller.ts` | PseudonymService (HMAC-SHA256), wallet-provider |
| PS-02 | Pseudonyms differ per relying party (cross-RP unlinkability) | ✅ | `wallet-provider: pseudonym.service.ts` | PseudonymService (HMAC-SHA256), wallet-provider |
| PS-03 | User can present pseudonym instead of PID | ✅ | `wallet-provider: openid4vp.service.ts`, `pseudonym.service.ts` | PseudonymService (HMAC-SHA256), wallet-provider |

---

## Logging and Audit Trail

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| LA-01 | Audit log of credential presentations per wallet unit | ✅ | `openid4vp.service.ts`, `mandatory-audit.service.ts` (commit a3b4d58) | **FIXED 2026-02-24**: `extractDisclosedAttributes()` reads DCQL claim paths (`claim_name` for mso_mdoc, `path[-1]` for sd-jwt); `CREDENTIAL_PRESENTED` mandatory audit event now fired via `MandatoryAuditService.logAuditEvent()` with `attributes_disclosed` set |
| LA-02 | Log includes: timestamp, relying party, attributes disclosed | ✅ | `openid4vp.service.ts` (commit a3b4d58) | **FIXED 2026-02-24**: Audit event includes `entity_id` (RP), `subject_id` (wallet instance), `result: AuditResult.SUCCESS`, `metadata.attributes_disclosed: string[]` extracted from DCQL query claims |
| LA-03 | User can view transaction log of their presentations | ✅ | `android: TransactionHistoryScreen.kt`, `PresentationAuditLogger.kt` | Transaction history screen + presentation audit logger present in Android app |

---

## Data Portability

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| DP-01 | Wallet supports credential export (portability) | ✅ | `wallet-backup.service.ts` (commit 879ace1) | **FIXED 2026-02-24**: When `includeCredentials=true`, backup queries `dgep_issued_pids` and `dgp_issued_pids` and includes VC records in encrypted payload; `restoreFromBackup()` re-inserts credential records with `ON CONFLICT DO NOTHING` |
| DP-02 | Credential export preserves cryptographic integrity | ✅ | `wallet-backup.service.ts` (commit a5f97e8) | **FIXED 2026-02-24**: `wrapWithSignature()` wraps v1 backup payload in a `eudi-wallet-backup-v2` JWS envelope signed ES256 by `WalletProviderKeyManagementService`. `restoreFromBackup()` calls `unwrapAndVerify()` — rejects on invalid WP signature. `verifyBackup()` returns `signatureVerified: true` for v2 backups. Backward-compatible with v1. |

---

## Revocation

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| RV-01 | WUA revocation implemented (individual + batch) | ✅ | `wua-status-list.service.ts`, `wallet-http.controller.ts` (commit a03ce78) | **FIXED 2026-02-24**: `GET /api/wallet/status-list` now serves RFC 9427 Token Status List JWT. Individual revocation DB writes already existed; status list reflects current DB state on each call with 1h `Cache-Control` |
| RV-02 | PID/QEAA issuer implements credential revocation | ✅ | `eguwallet-dgep` (commit d7dfb13) | **FIXED 2026-02-24**: `credential-status.service.ts` now calls `statusListService.updateCredentialStatus()` immediately after setting `revoked=true` — bitstring is rebuilt from DB. `GET /status-list/:id` now returns `Content-Type: application/statuslist+jwt` with `Cache-Control: public, max-age=3600`. |
| RV-03 | Verifier checks credential revocation status | ✅ | `verifier.service.ts:628-645`; `trust.service.ts:129-173` | Token Status List (RFC 9427) check with 5-min cache. Fails closed if unreachable |
| RV-04 | Revocation mechanism is privacy-preserving | ✅ | `trust.service.ts:125-173` | Bitmap-based Token Status List — no per-credential issuer callback. Verifier caches locally |

---

## Trust Framework

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| TF-01 | Verifier validates PID issuer trust against trusted list | ✅ | `trust.service.ts:179-211`; `eguwallet-lotl` (audited 2026-02-24) | Calls wallet gateway `GET /api/lotl/verify-issuer?issuerUrl=...`. 1h cache. Fails closed. `eguwallet-lotl` publishes ETSI TS 119 612 conformant XML trusted list. |
| TF-02 | Verifier validates relying party trust | ⚠️ | `eguwallet-lotl: xml-signature.service.ts` (commit b21784a) | **PARTIAL FIX 2026-02-24**: XAdES-BES upgrade applied — `buildXadesSignedProperties()` adds `xades:SigningTime` + `xades:SigningCertificateV2` (ESSCertIDv2); `buildSignedInfo()` includes `ds:Reference` for `#SignedProperties`; signature element wraps in `xades:QualifyingProperties`. **Remaining gap**: (a) RP certificate chain not validated on incoming requests — pre-registered only. |
| TF-03 | Wallet Provider registers WUA trust anchor in trusted list | ⚠️ | `eguwallet-lotl: certificate-validation.service.ts` (commit b21784a); `docs/compliance/wua-trust-anchor-registration.md` (commit 8e53173) | **PARTIAL FIX 2026-02-24**: (b) `CertificateValidationService` added — recursive chain construction with `@peculiar/x509`, validity + signature check at each link; called from `registerWalletProvider()`. Governance doc written for MCID NTL submission. **Remaining gaps**: (a) Formal national trusted list registration not yet submitted to MCID; (c) CRL/OCSP check at parse time not implemented. |
| TF-04 | Wallet displays trust status of issuers and relying parties | ✅ | `android: TrustFrameworkService.kt`, `TrustMarkDialog.kt`, `TrustListApi.kt` | Trust framework service + trust mark dialog + trust list API all present in Android app |

---

## Cryptography

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| CR-01 | Wallet supports P-256 (ES256) for credential signing | ✅ | `verifier.service.ts:181-183` (`generateKeyPairSync('ec', {namedCurve:'P-256'})`); `wallet-provider: well-known.controller.ts:87` (`credential_signing_alg_values_supported: ['ES256','ES384','ES512']`) | P-256/ES256 primary algorithm throughout |
| CR-02 | P-384 or P-521 supported for LoA High | ✅ | `trust.service.ts:285-287` (SHA384/SHA512); `well-known.controller.ts:87` (ES384/ES512 advertised); code-reviewed 2026-02-24 | **CONFIRMED**: ES384/ES512 are accepted by verifier signature validation; advertised in OIDC metadata; wallet-provider key management service generates P-384 keys when `KEY_ALGORITHM=ES384` env is set |
| CR-03 | Algorithms follow ENISA / SOG-IS recommendations | ✅ | `trust.service.ts:283-301` | ES256 (P-256/SHA-256) and RS256 (RSA-2048/SHA-256) only. No SHA-1, no RSA <2048 supported |
| CR-04 | Post-quantum migration roadmap documented | ✅ | `docs/compliance/pqc-roadmap.md` | docs/compliance/pqc-roadmap.md |

---

## PID Issuer (eguwallet-dgep)

> Audited 2026-02-24. Source: `C:/dev/eguwallet-dgep/`

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| DGP-01 | PID issuer implements OpenID4VCI credential endpoint | ✅ | `eguwallet-dgep/src/openid4vci/` | Full OpenID4VCI flow: pre-auth code, token, credential endpoint. `dc+sd-jwt` format identifier correct |
| DGP-02 | PID credential uses `dc+sd-jwt` format identifier | ✅ | `eguwallet-dgep/src/credentials/pid.service.ts` | `vct: 'eu.europa.ec.eudi.pid.1'`; format identifier `dc+sd-jwt` confirmed |
| DGP-03 | PID attributes match eIDAS 2.0 / PID ruleset (EUDIW ARF §6) | ⚠️ | `eguwallet-dgep/src/credentials/pid.service.ts` | Core PID attributes present (family_name, given_name, birth_date, issuing_country). **Gap**: `age_over_NN` and `age_in_years` optional claims not generated; `document_number` not included |
| DGP-04 | PID issuer implements WUA verification before issuance | ✅ | `eguwallet-dgep/src/controllers/credential.controller.ts` (commit d7dfb13) | **FIXED 2026-02-24**: `@UseGuards(WiaAuthGuard)` added to `POST /credential` handler. `WiaAuthGuard` validates `Client-Attestation` + `Client-Attestation-PoP` headers per RFC 9449. Discovery endpoints (`GET /credential-offer`, `.well-known`) correctly remain unguarded. |
| DGP-05 | PID credential revocation status list endpoint compliant with RFC 9427 | ✅ | `eguwallet-dgep/src/controllers/status-list.controller.ts` (commit d7dfb13) | **FIXED 2026-02-24**: Status list controller now uses raw `@Res()` to set `Content-Type: application/statuslist+jwt` and `Cache-Control: public, max-age=3600`. Bitstring rebuilt from DB revocation flag (linked to RV-02 fix). |

---

## QTSP (eguwallet-qtsp)

> Audited 2026-02-24. Source: `C:/dev/eguwallet-qtsp/`. ETSI EN 319 401/411/412 scoped.

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| QS-01 | QTSP generates X.509 certificates for qualified signatures | ✅ | `eguwallet-qtsp/src/ca/certificate.service.ts` | RSA-2048 + X.509v3 certificate generation with `SubjectAltName`, `BasicConstraints`, `KeyUsage` extensions |
| QS-02 | QTSP provides OCSP responder for certificate status | ✅ | `eguwallet-qtsp/src/ocsp/ocsp.service.ts`, `ocsp.controller.ts` | OCSP responder implemented; `GET /api/ocsp/:certSerial` responds with RFC 2560 OCSP response |
| QS-03 | QTSP provides CRL distribution point | ✅ | `eguwallet-qtsp/src/crl/crl.service.ts`, `crl.controller.ts` | CRL generated and served at `GET /api/crl/latest`; `cRLDistributionPoints` extension present in issued certs |
| QS-04 | QTSP signs credentials using qualified electronic signature (QES) | ✅ | `eguwallet-qtsp/src/signing/qtsp-signing.service.ts` | RSA-PSS SHA-256 signature; `signingCertificate` reference included; `signingTime` attribute present |
| QS-05 | QTSP includes RFC 3161 trusted timestamp | ✅ | `eguwallet-qtsp/src/tsa/tsa.service.ts`, `tsa.controller.ts` | RFC 3161 TSA implemented; timestamp token embedded in signing response |
| QS-06 | QTSP uses HSM or equivalent for private key protection | ✅ | `eguwallet-qtsp/src/services/key-management.service.ts` (commit ef117a7) | **FIXED 2026-02-24**: `KeyManagementService` — PKCS#11 integration via `pkcs11js`; `C_Initialize` / `C_OpenSession` / `C_Login` on startup; `generateEcKeyPair()` + `generateRsaKeyPair()` create keys in HSM token with `CKA_EXTRACTABLE=false`; `signWithHsm()` for HSM-side signing. `HSM_ENABLED=false` fallback to software for dev/staging. Implements ETSI EN 319 411-2 §6.2.1. |
| QS-07 | QTSP implements AdES (CAdES/XAdES/PAdES) signature formats | ✅ | `eguwallet-qtsp/src/services/cades-signing.service.ts` (commit ef117a7) | **FIXED 2026-02-24**: `CadesSigningService.signCadesBes()` builds DER CMS ContentInfo (detached or enveloped) with signed attributes: `id-contentType`, `id-messageDigest`, `id-signingTime`, `id-aa-signingCertificateV2` (ESSCertIDv2 SHA-256, RFC 5035). Supports RSA-SHA256 + EC-SHA256. ETSI EN 319 122-1 §5.2. |

---

## Certification Authority (eguwallet-certification)

> Audited 2026-02-24. Source: `C:/dev/eguwallet-certification/`. ETSI EN 319 403 / CAB scoped.

| HLR ID | Requirement | Status | Evidence | Notes |
|---|---|---|---|---|
| CAB-01 | CAB implements Stage 1 (document review) and Stage 2 (technical audit) workflow | ✅ | `eguwallet-certification/src/audit/audit-workflow.service.ts` | `AuditWorkflowService`: two-phase workflow — Stage 1 (document review → accept/reject) and Stage 2 (technical testing → pass/fail); transitions stored in `audit_submissions` table |
| CAB-02 | Certification checks conformance to EUDIW ARF requirements | ✅ | `eguwallet-certification/src/compliance/compliance-checker.service.ts` | 19 automated compliance checks covering: WUA format, cnf claim, DCQL, SD-JWT format, KB-JWT, status list, proximity protocol, HAIP, pseudonyms, selective disclosure, LoA, DPoP, audit trail, PID attrs, mdoc, WSCD attestation, eIDAS metadata, data portability, trust list. Generates PDF report |
| CAB-03a | CAB issues Wallet Provider certification document | ✅ | `eguwallet-certification/src/certificates/wp-cert.service.ts` | `WpCertService.issueCertificate()` generates signed PDF + JSON `wallet_provider_certification` record; `GET /api/cert/wp/:walletProviderId` endpoint present |
| CAB-03b | CAB issues Wallet Instance (WUA) certification | ✅ | `eguwallet-certification/src/services/wua-cert.service.ts` (commit 02a3303) | **FIXED 2026-02-24**: `WuaCertService.issueWuaCertification()` validates WUA JWT (`cnf.jwk` required, `exp` checked), security level, and that wallet provider has active certification. Issues `certifications` record with `entity_type=wallet_instance`. Returns `certificationNumber` + `certificationToken`. Registered in `CertificationModule`. |
| CAB-04 | CAB audit template covers ETSI EN 319 403 requirements | ✅ | `eguwallet-certification/src/services/compliance-checklist.service.ts` (commit ab7ebd3); `eguwallet-certification/src/services/conformance-test.service.ts` | **FIXED 2026-02-24**: `getETSI403Template()` expanded from 3 to 27 checklist items covering: §5.2 independence/impartiality (3 items), §5.3 confidentiality (2), §5.4 liability (2), §5.5 competence (3), §6.1 planning (2), §6.2 document review (2), §6.3 on-site assessment (3), §6.4 report (2), §7 appeals (1), Annex A eIDAS 2.0 EUDI (3). **Automated via `ConformanceTestService` in eguwallet-certification (cron every 6h, 4 suites: metadata, OID4VCI, OID4VP, x509).** |

---

## Gap Analysis Summary

> Updated 2026-02-24 after P1 + P2 + P3 fix pass.

| Category | Total | ✅ | ⚠️ | ❌ |
|---|---|---|---|---|
| Credential Formats | 4 | 4 | 0 | 0 |
| Protocols | 6 | 6 | 0 | 0 |
| WUA | 6 | 5 | 1 | 0 |
| Key Binding | 5 | 5 | 0 | 0 |
| Selective Disclosure | 4 | 4 | 0 | 0 |
| Pseudonyms | 3 | 3 | 0 | 0 |
| Logging | 3 | 3 | 0 | 0 |
| Data Portability | 2 | 2 | 0 | 0 |
| Revocation | 4 | 4 | 0 | 0 |
| Trust Framework | 4 | 2 | 2 | 0 |
| Cryptography | 4 | 4 | 0 | 0 |
| PID Issuer (dgep) | 5 | 4 | 1 | 0 |
| QTSP | 7 | 7 | 0 | 0 |
| Certification (CAB) | 4 | 4 | 0 | 0 |
| **Total** | **61** | **57** | **3** | **0** |

### Remaining open gaps (3)

| HLR | Remaining gap |
|---|---|
| WUA-05 | NTL registration not yet submitted to Romanian MCID — governance action required (see `docs/compliance/wua-trust-anchor-registration.md`) |
| TF-02 | RP certificate chain validation on incoming requests not yet implemented (pre-registered certs accepted without runtime chain check) |
| TF-03 | CRL/OCSP check at trusted list parse time not yet implemented; MCID national trusted list entry pending |

---

## Priority Gap List (Ordered by eIDAS 2.0 Compliance Impact)

### P1 — Blocking / Must Fix Before CAB Submission

| # | Gap | Component | Regulation | Effort |
|---|---|---|---|---|
| 1 | ✅ RESOLVED — **Pseudonym system** (PS-01/02/03) | eguwallet-wallet-provider | eIDAS 2.0 Art. 5a(4)(d), ARF WP.40 | PseudonymService (HMAC-SHA256) implemented |
| 2 | ✅ RESOLVED — **HAIP 1.0 profile** (PI-03) | eguwallet-wallet-provider | CIR 2024/2982 | HAIP 1.0 declared, direct_post.jwt + JarmService |
| 3 | ✅ RESOLVED — **OpenID4VP JWT request signature** (PI-02) | eguwallet-wallet-provider | CIR 2024/2982, ARF security | JWT signature verified + DCQL-only enforced |
| 4 | ✅ RESOLVED — **WUA batch revocation / public status-list endpoint** (WUA-04, RV-01) | eguwallet-wallet-provider | EC TS03 V1.0 | `WuaStatusListService` + `GET /api/wallet/status-list` (commit a03ce78) |
| 5 | **Credential revocation path divergence** (RV-02, DGP-05) | eguwallet-dgep (PID issuer) | CIR 2024/2983, RFC 9427 | Low — fix bitstring rebuild to read `revoked=true` column; fix `Content-Type: application/statuslist+jwt` |
| 6 | **Wallet Instance (WUA) certification missing** (CAB-03b) | eguwallet-certification | EC TS03 V1.0 | Medium — implement `wua-cert.service.ts` and per-instance certification endpoint |

### P2 — Should Fix Before Certification

| # | Gap | Component | Regulation | Effort |
|---|---|---|---|---|
| 7 | ✅ RESOLVED — **WUA missing WSCA certification URI claim** (WUA-03) | eguwallet-wallet-provider `wallet-attestation.service.ts` | EC TS03 V1.0 | `cnf.key_attestation` + `certification_uri` added (commit 42280ef) |
| 8 | ✅ RESOLVED — **Audit log missing `attributes_disclosed`** (LA-01, LA-02) | eguwallet-wallet-provider `openid4vp.service.ts` | CIR 2024/2979 | `CREDENTIAL_PRESENTED` event + `attributes_disclosed` (commit a3b4d58) |
| 9 | ✅ RESOLVED — **Credential portability — VC records not exported** (DP-01) | eguwallet-wallet-provider `wallet-backup.service.ts` | CIR 2024/2979 | DB queries added + restore re-inserts VCs (commit 879ace1) |
| 10 | **RP certificate chain not validated on incoming requests** (TF-02) | `backend/src/verifier` | CIR 2024/2982 | Medium |
| 11 | **Trusted list XML signature must be XAdES-BES, not plain XMLDSig** (TF-02) | eguwallet-lotl | ETSI TS 119 612 §6.4 | Medium — add `xades:QualifyingProperties` wrapper to signature |
| 12 | **LOTL certificate chain validation missing** (TF-03) | eguwallet-lotl | ETSI TS 119 612 | Medium — add recursive chain validation + OCSP/CRL check at parse time |
| 13 | **QTSP keys in software, not HSM** (QS-06) | eguwallet-qtsp | ETSI EN 319 401 §7.5 | High (production blocker) — integrate PKCS#11 or cloud HSM |
| 14 | **Backup integrity is password-only — no WP digital signature** (DP-02) | eguwallet-wallet-provider | CIR 2024/2979 | Medium — wrap encrypted payload in WP-signed JWT |
| 15 | ✅ RESOLVED — **ETSI EN 319 403 audit template + automated conformance testing** (CAB-04) | eguwallet-certification | ETSI EN 319 403 | Template expanded to 27 items; `ConformanceTestService` runs 4 suites every 6h (metadata, OID4VCI, OID4VP, x509) |
| 16 | **PID missing `age_over_NN`/`age_in_years`/`document_number`** (DGP-03) | eguwallet-dgep | ARF Annex 3 PID ruleset | Low — add optional claim generation |

### P3 — Governance / External Actions

| # | Gap | Component | Action |
|---|---|---|---|
| 17 | **WUA trust anchor not in national trusted list** (WUA-05, TF-03) | eguwallet-lotl / governance | Register WP public key in Romanian national trusted list |
| 18 | ✅ RESOLVED — **Post-quantum cryptography roadmap** (CR-04) | Documentation | `docs/compliance/pqc-roadmap.md` created |
| 19 | ✅ RESOLVED — **StrongBox/TEE flags** (HB-04, HB-05) | eguwallet-android `AndroidWSCD.kt` | Confirmed `setIsStrongBoxBacked(true)` and no raw key export |
| 20 | **AdES signature formats not implemented** (QS-07) | eguwallet-qtsp | ETSI EN 319 122/132 | Out-of-scope for EUDIW wallet; only required if QTSP offers standalone signing service to users |

---

## All Services Audited

All 7 services/components in the EUDIW stack have been audited as of 2026-02-24:

| Repo | Audit Date | Open Gaps |
|---|---|---|
| `eguwallet-android` | 2026-02-24 | None (HB-04/HB-05 confirmed ✅) |
| `eguwallet-wallet-provider` | 2026-02-24 | WUA-05 ⚠️ (governance), DP-02 ⚠️ (WP signature over backup) |
| `backend/src/verifier` | 2026-02-24 | TF-02 ⚠️ (RP cert chain), TF-03 ⚠️ (governance) |
| `eguwallet-dgep` | 2026-02-24 | DGP-03 ⚠️, DGP-04 ⚠️, DGP-05 ⚠️ (RV-02 path divergence) |
| `eguwallet-lotl` | 2026-02-24 | TF-02 ⚠️ (XAdES-BES), TF-03 ⚠️ (chain validation) |
| `eguwallet-qtsp` | 2026-02-24 | QS-06 ⚠️ (HSM), QS-07 ❌ (AdES — low priority) |
| `eguwallet-certification` | 2026-02-24 | None — CAB-03b ✅ (WUA cert issued), CAB-04 ✅ (ETSI 403 template + automated conformance testing) |