# eIDAS 2.0 Compliance — EguWallet

> Last updated: 2026-02-24
> Regulation baseline: CIR 2024/2979, 2024/2980, 2024/2981, 2024/2982, 2024/2983 (in force 24 Dec 2024)
> ARF baseline: v2.5.0
> Deadline: **December 2026** — certified wallet must be available

## Index

| File | Contents |
|---|---|
| [certification-process.md](./certification-process.md) | Full CAB certification phases, documentation package, timeline |
| [arf-hlr-checklist.md](./arf-hlr-checklist.md) | ARF Annex 2 High-Level Requirements gap analysis (WALLET-PROVIDER-* items) |
| [iso-standards.md](./iso-standards.md) | ISO/IEC 15408 (Common Criteria), ISO 27001, ISO 18013-5/7 |
| [etsi-standards.md](./etsi-standards.md) | ETSI TS/EN requirements and applicability |

---

## Regulatory Framework

Five Commission Implementing Regulations govern the EUDI Wallet:

| Regulation | Topic | Primary Actor |
|---|---|---|
| **CIR 2024/2979** | Wallet integrity & core functionalities | Wallet Provider |
| **CIR 2024/2980** | Ecosystem notifications to the Commission | Wallet Provider / Member State |
| **CIR 2024/2981** | **Certification** — the primary compliance instrument | Wallet Provider |
| **CIR 2024/2982** | Protocols and interfaces for interoperability | Wallet Provider |
| **CIR 2024/2983** | PID and EAA issuance / revocation rules | PID/QEAA Issuers |

A second batch of 7 implementing regulations (published 30 July 2025) covers trust services (QTSP, QES, etc.) — applicable to the eguwallet QTSP service.

---

## Architecture Components (eIDAS 2.0 Terminology)

```
EguWallet Ecosystem
│
├── Wallet Application (Android app — eguwallet-android)
│   └── WSCA (Wallet Secure Cryptographic Application)
│       └── WSCD (Wallet Secure Cryptographic Device)
│           → Must be hardware-backed (SE or StrongBox TEE on Android)
│
├── Wallet Provider Backend (eguwallet-wallet-provider)
│   ├── Wallet Unit Attestation (WUA) issuance & revocation
│   ├── OpenID4VCI issuance endpoint
│   └── OpenID4VP presentation verification
│
├── PID Issuer (backend/src/pid-issuer/)
│   └── Issues SD-JWT PID credentials via OpenID4VCI
│
├── QTSP (eguwallet-qtsp)
│   └── Qualified Trust Service Provider — electronic signatures
│
├── Verifier (backend/src/verifier/)
│   └── Validates SD-JWT presentations with DCQL queries
│
└── LOTL / Certification Authority (eguwallet-lotl, eguwallet-cert)
    └── Trust anchor management
```

---

## Compliance Roles

Your ecosystem plays **multiple roles** under eIDAS 2.0 — each has distinct requirements:

| Role | Entity | Primary Regulation |
|---|---|---|
| **Wallet Provider** | eguwallet-android + wallet-provider backend | CIR 2024/2981 (certification) |
| **PID Issuer** | backend/src/pid-issuer | CIR 2024/2983 + ETSI TS 119 461 |
| **QEAA Provider** | eguwallet-qtsp | CIR 2024/2983 + ETSI EN 319 series |
| **Relying Party** | backend/src/verifier | CIR 2024/2982 + ETSI TS 119 475 |
| **QTSP** | eguwallet-qtsp | eIDAS 2.0 Art. 24 + EN 319 401/411 |

---

## Self-Certifiable Today (Quick Wins)

These require no CAB — start immediately:

### 1. OpenID Foundation Protocol Self-Certification
Launched February 2026. Submit test logs; OIDF publishes results publicly.

| Spec | Cost (OIDF member) | Cost (non-member) | Status |
|---|---|---|---|
| OpenID4VCI 1.0 Final | $700 | $3,500 | ☐ Not started |
| OpenID4VP 1.0 Final | $700 | $3,500 | ☐ Not started |
| HAIP 1.0 | $700 | $3,500 | ☐ Not started |

> [openid.net/certification](https://openid.net/certification)

### 2. EWC Interoperability Test Bed (ITB)
Open-source; run locally against your implementation.
> [github.com/EWC-consortium/ewc-wallet-conformance-backend](https://github.com/EWC-consortium/ewc-wallet-conformance-backend)

### 3. ARF HLR Gap Analysis
Download ARF Annex 2, filter `WALLET-PROVIDER-*` requirements, assess COMPLIANT / PARTIAL / NON-COMPLIANT.
See [arf-hlr-checklist.md](./arf-hlr-checklist.md).

---

## Master Roadmap

| Phase | Timeframe | Action | Owner |
|---|---|---|---|
| **0 — Assess** | Now | ARF HLR gap analysis | Engineering |
| **0 — Assess** | Now | WSCD audit: confirm Android StrongBox / SE type | Security |
| **0 — Assess** | Now | OIDF self-certification (OpenID4VCI + OpenID4VP + HAIP) | Engineering |
| **0 — Assess** | Now | EWC ITB conformance self-test | Engineering |
| **1 — Document** | Q1 2026 | System architecture doc (all components + interfaces) | Architecture |
| **1 — Document** | Q1 2026 | Threat model + risk register (CIR 2024/2981 Annex I) | Security |
| **1 — Document** | Q1 2026 | Key management policy (WUA signing keys) | Security |
| **1 — Document** | Q1 2026 | WUA issuance + revocation process doc (per EC TS03) | Engineering |
| **1 — Document** | Q1 2026 | Vulnerability management policy (CRA Annex I aligned) | Security |
| **2 — ISMS** | Q1–Q2 2026 | Start ISO/IEC 27001 ISMS implementation | Management |
| **2 — ISMS** | Q2 2026 | Internal audit + management review | Management |
| **3 — CAB** | Q2 2026 | Identify + engage accredited CAB and ITSEF | Management |
| **3 — CAB** | Q2 2026 | Submit Phase 1 documentation package to CAB | All |
| **4 — Evaluate** | Q3 2026 | WSCA evaluation per CIR 2024/2981 Annex IV | ITSEF / CAB |
| **4 — Evaluate** | Q3–Q4 2026 | WSCD Common Criteria evaluation (EAL4+ AVA_VAN.5) | ITSEF |
| **5 — Certify** | Q4 2026 | Certificate of Conformity issued by CAB | CAB |
| **5 — Certify** | Q4 2026 | Member State notification to Commission (CIR 2024/2980) | Member State |
| **6 — Deploy** | Dec 2026 | Certified wallet available to citizens | All |

---

## Key Reference Links

| Resource | URL |
|---|---|
| ARF 2.5.0 | https://eu-digital-identity-wallet.github.io/eudi-doc-architecture-and-reference-framework/2.5.0/ |
| ARF GitHub | https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework |
| EC Technical Specs (TS01–TS03+) | https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications |
| CIR 2024/2981 (Certification) | https://eur-lex.europa.eu/eli/reg_impl/2024/2981/oj |
| CIR 2024/2979 (Core Functions) | https://eur-lex.europa.eu/eli/reg_impl/2024/2979/oj |
| CIR 2024/2980 (Notifications) | https://eur-lex.europa.eu/eli/reg_impl/2024/2980/oj |
| CIR 2024/2982 (Protocols) | https://eur-lex.europa.eu/eli/reg_impl/2024/2982/oj |
| ENISA EUDI Wallet Certification | https://certification.enisa.europa.eu/browse-topic/eudi-wallet_en |
| ENISA Find a CAB | https://certification.enisa.europa.eu/take-action/find-conformity-assessment-body_en |
| OIDF Self-Certification | https://openid.net/certification/ |
| EWC ITB | https://github.com/EWC-consortium/ewc-wallet-conformance-backend |
| EWC RFCs | https://github.com/EWC-consortium/eudi-wallet-rfcs |
| EC Launchpad Testing | https://ec.europa.eu/digital-building-blocks/sites/spaces/EUDIGITALIDENTITYWALLET/pages/930453034/Launchpad+Testing |