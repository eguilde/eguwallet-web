# ETSI Standards — eIDAS 2.0 Requirements

> Last updated: 2026-02-24

Standards are grouped by applicability to EguWallet roles.
Legend: ✅ Directly applicable | ⚠️ Applicable if acting as TSP/QTSP | ℹ️ Reference only

---

## EC Technical Specifications (EU Toolbox — highest priority)

These are published by the European Commission as binding technical specifications alongside
the implementing regulations.

| Spec | Version | Topic | Applies To | Status |
|---|---|---|---|---|
| **EC TS01** | V1.0 (Apr 2025) | EUDI Wallet Trust Mark specification | Wallet Provider | ☐ |
| **EC TS02** | V1.0 | Relying Party specification | Verifier / Relying Party | ☐ |
| **EC TS03** | V1.0 (Aug 2025) | **Wallet Unit Attestation (WUA)** — format, signing, revocation | Wallet Provider | ☐ |

> All EC Technical Specs:
> https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications

### EC TS03 — WUA (Critical for EguWallet)

The WUA is a **JWT-signed attestation** issued by the Wallet Provider to each individual
Wallet Unit (a specific user's app instance). Issuers (PID providers, QEAA providers) will
refuse to issue credentials to a wallet unit without a valid WUA.

Key requirements for the wallet-provider backend:
- Maintain a signing keypair (WUA issuer key) — document in Key Management Policy
- Issue WUAs per EC TS03 format on wallet instance registration
- Implement WUA revocation (individual + batch)
- Trust anchor (WUA public key) must be registered in the national trusted list

> Implementation location: `eguwallet-wallet-provider`
> Current status: Audit `apps/wallet-provider/src/` for WUA issuance endpoint

---

## Wallet Provider Standards ✅

Standards directly applicable to the wallet application and wallet-provider backend.

### ETSI TS 119 471 V1.1.1 (May 2025) ✅
**Topic:** EAA policy and security requirements
**URL:** https://www.etsi.org/deliver/etsi_ts/119400_119499/119471/01.01.01_60/ts_119471v010101p.pdf

Covers:
- Verification requirements before issuing/accepting PID or EAA
- Mutual authentication between wallet and issuer
- Device binding requirements
- Requirements on the issuance protocol

**EguWallet action:** Audit `backend/src/pid-issuer/` and `eguwallet-wallet-provider` against
TS 119 471 requirements for the issuance flow.

---

### ETSI TS 119 475 V1.1.1 (Oct 2025) ✅
**Topic:** Relying party attributes for wallet user authorisation decisions
**URL:** https://www.etsi.org/deliver/etsi_ts/119400_119499/119475/01.01.01_60/ts_119475v010101p.pdf

Covers:
- Attributes that relying parties must include in their access certificates
- How the wallet uses relying party certificate attributes to make authorisation decisions
- User consent presentation requirements

**EguWallet action:** Audit `backend/src/verifier/` against relying party trust requirements.

---

### ETSI TS 119 411-8 V1.1.1 (Oct 2025) ✅
**Topic:** Policy requirements for providers of wallet-relying party access certificates

Covers:
- Certificate policy for CAs issuing access certificates to relying parties
- Registration requirements for relying parties wanting to interact with wallets

**EguWallet action:** If EguWallet operates a relying party registry (for verifiers to register),
this standard applies to the CA issuing their certificates. Relevant to `eguwallet-cert`.

---

## PID Issuer Standards ✅

Applicable to `backend/src/pid-issuer/pid-issuer.service.ts`.

### ETSI TS 119 461 V2.1.1 (Feb 2025) ✅
**Topic:** Identity proofing for qualified trust services
**URL:** https://www.etsi.org/deliver/etsi_ts/119400_119499/119461/02.01.01_60/ts_119461v020101p.pdf

Directly mandated by CIR 2024/2983 for PID providers. Defines:
- Identity proofing methods and their LoA mapping
- Remote identity proofing with document + liveness check (LoA Substantial)
- Remote identity proofing with NFC chip reading (LoA High)
- In-person identity proofing (LoA High)

**EguWallet action:** The PID issuer must implement one of the ETSI TS 119 461-compliant
identity proofing methods before issuing PID credentials.

---

### ETSI TR 119 476 V1.3.1 (Aug 2025) ℹ️
**Topic:** Analysis of selective disclosure mechanisms (SD-JWT, ZKP) for EAAs
**URL:** https://www.etsi.org/deliver/etsi_tr/119400_119499/11947601/01.03.01_60/tr_11947601v010301p.pdf

Technical report (informative, not normative) covering:
- Selective disclosure with SD-JWT VC
- Zero-knowledge proof approaches for privacy-preserving credentials
- Recommendations for credential format selection

**EguWallet action:** Reference for implementing SD-JWT selective disclosure in `pid-issuer`.
Confirms that `dc+sd-jwt` format (currently implemented) is correct.

---

## QTSP / Trust Service Provider Standards ⚠️

Applicable to `eguwallet-qtsp`. These apply because eguwallet-qtsp operates as a QTSP
(Qualified Trust Service Provider) under eIDAS 2.0.

### ETSI EN 319 401 ⚠️
**Topic:** General policy requirements for Trust Service Providers
Mandates:
- ISMS equivalent to ISO/IEC 27001
- Regular audits by accredited conformity assessment body
- Termination plan for trust services

---

### ETSI EN 319 411-1 V1.3.1 ⚠️
**Topic:** Policy requirements for CAs issuing public key certificates
Covers:
- Certificate policy structure
- CA operational requirements
- Key ceremony requirements

---

### ETSI EN 319 412 series ⚠️
**Topic:** Certificate profiles

| Part | Topic | Relevance |
|---|---|---|
| EN 319 412-1 | General overview | All certs |
| EN 319 412-2 | Certificate profile for QESPs | QTSP signing certs |
| EN 319 412-3 | PSD2 certificates | N/A |
| EN 319 412-4 | Web authentication certificates | N/A |
| EN 319 412-5 | QC statements | QTSP QES certificates |
| **TS 119 412-6** | PID / Wallet / EAA / QEAA certificate profile | Wallet + PID + QEAA |

---

### ETSI EN 319 101 ⚠️
**Topic:** Requirements for advanced electronic signatures (AdES)
Covers signing and verification requirements for AdES formats (XAdES, CAdES, PAdES, JAdES).

---

### ETSI TS 119 441 ⚠️
**Topic:** Signature validation service policy requirements
Applicable if eguwallet-qtsp provides signature validation as a service.

---

### ETSI EN 319 102-1 ⚠️
**Topic:** Procedures for creation and validation of AdES digital signatures
Technical procedures for the signature lifecycle.

---

## Upcoming / In Development ℹ️

| Standard | Status | Topic |
|---|---|---|
| ETSI TS 119 471 V2.x | In development | EAA requirements update |
| ETSI + CEN PQC updates | In progress (2025 PQC Conference) | Post-quantum cryptography for 319 series |
| prCEN/TS 18098 | Draft | Guidelines for PID onboarding into EUDI Wallets |
| ENISA EUDI Wallet Certification Scheme | Under development (AHWG) | Pan-EU certification scheme |

---

## Standards Compliance Matrix

| EguWallet Component | Required Standards | Status |
|---|---|---|
| eguwallet-android (wallet app) | ARF 2.5 HLRs, EC TS03 (WUA), ISO 18013-5 (mdoc proximity) | ☐ |
| eguwallet-wallet-provider | EC TS03, CIR 2024/2979, CIR 2024/2982, ETSI TS 119 471 | ☐ |
| backend/src/pid-issuer | CIR 2024/2983, ETSI TS 119 461, ETSI TR 119 476, ISO 29003 | ☐ |
| backend/src/verifier | CIR 2024/2982, ETSI TS 119 475, DCQL spec (ARF 2.5+) | ☐ |
| eguwallet-qtsp | ETSI EN 319 401/411/412, ISO 27001, CIR 2024/2983 | ☐ |
| eguwallet-cert | ETSI TS 119 411-8, EN 319 401 | ☐ |
| eguwallet-lotl | Trusted List format (ETSI TS 119 612) | ☐ |