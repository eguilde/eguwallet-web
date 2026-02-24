# Certification Process — CIR 2024/2981

> Last updated: 2026-02-24
> Governing regulation: Commission Implementing Regulation (EU) 2024/2981
> EUR-Lex: https://eur-lex.europa.eu/eli/reg_impl/2024/2981/oj

---

## Overview

eIDAS 2.0 mandates **third-party conformity assessment** for all wallet solutions — there is no
self-declaration path (unlike CE marking). A CAB (Conformity Assessment Body) accredited under
**EN ISO/IEC 17065:2012** performs the assessment and issues the Certificate of Conformity.

The certificate is valid for up to **5 years** (Article 5c(4) of eIDAS 2.0).

---

## Key Actors

| Actor | Role |
|---|---|
| **Wallet Provider** | EguWallet — submits documentation, undergoes evaluation |
| **CAB** | Conformity Assessment Body — accredited by national accreditation body |
| **ITSEF** | IT Security Evaluation Facility — performs technical security evaluation of WSCA/WSCD |
| **National Accreditation Body** | Accredits CABs (e.g., RENAR in Romania, DAkkS in Germany) |
| **Member State** | Issues wallet under national eID scheme; notifies Commission |
| **Commission** | Publishes certified wallets in trusted list |
| **ENISA** | Developing EU-level certification scheme (AHWG — not ready before Dec 2026) |

---

## Security Assurance Level Required

Wallet solutions must be resistant against attackers with **high attack potential**
(eIDAS LoA High, per Implementing Regulation 2015/1502).

In Common Criteria terms:
- **AVA_VAN.5** — highest vulnerability analysis level
- **EAL4+** minimum for hardware components (WSCD)

---

## Conformance Testing Layers

### Layer 1 — Protocol Self-Certification (OpenID Foundation)
Self-certifiable, launched February 2026. Results published at openid.net/certification.

| Spec | Status | Notes |
|---|---|---|
| OpenID4VCI 1.0 Final | ☐ | $700 OIDF member / $3,500 non-member |
| OpenID4VP 1.0 Final | ☐ | $700 / $3,500 |
| HAIP 1.0 | ☐ | $700 / $3,500 |

### Layer 2 — National Certification Scheme (CAB Assessment)
The main mandatory certification path per CIR 2024/2981.
Covers: functional testing, WSCA cybersecurity evaluation, WSCD certification review,
eID scheme audit, maintenance process assessment.

### Layer 3 — EC Launchpad (Cross-Border Interoperability)
Not a mandatory gate but produces strong evidence. First event: December 2025, Brussels.
Next events: monitor EC Digital Building Blocks portal.

### Layer 4 — EWC ITB (Pre-Testing)
Open-source self-test. Run before engaging CAB.
> https://github.com/EWC-consortium/ewc-wallet-conformance-backend

---

## WSCD / WSCA: The Critical Path

The Wallet Secure Cryptographic Device (WSCD) and Wallet Secure Cryptographic Application (WSCA)
are the hardest components to certify and the longest lead-time items.

### WSCD (Hardware)
The physical or hardware-backed secure element:

| Implementation | CC Requirement |
|---|---|
| Hardware SE (dedicated chip) | EAL4+ with ALC_DVS.2 + AVA_VAN.5 |
| HSM-based | EAL4+ with AVA_VAN.5 |
| Android StrongBox TEE | SOG-IS / SESIP / CEN EN 17927 evaluation |

> **Action required:** Confirm which WSCD type the Android app uses.
> Android StrongBox (if Titan M chip) is the strongest option. Check `KeyInfo.isInsideSecureHardware()`.

### WSCA (Cryptographic Application)
The software component running on the WSCD. Evaluated per **CIR 2024/2981 Annex IV**.

**Critical problem — Composite Evaluation:**
- WSCA certification binds to the exact WSCD version and vendor
- Any security update to WSCA triggers Flaw Remediation cycle (can take months)
- Every WSCD change requires WSCA re-evaluation

**Mitigation:** Use GlobalPlatform Cryptographic Service Provider (CSP) Configuration —
single applet certificate valid across all GP-compliant SE platforms.

---

## Documentation Package (What You Must Produce)

### Phase 1 — CAB Application

| Document | Based On | Status |
|---|---|---|
| System architecture doc (all components, all interfaces) | CIR 2024/2981 Annex II | ☐ |
| Data flow diagrams (issuance + presentation flows) | CIR 2024/2981 Annex II | ☐ |
| WSCD identification + existing CC certificate | CIR 2024/2981 Annex II | ☐ |
| WSCA design documentation | CIR 2024/2981 Annex IV | ☐ |
| Wallet instance lifecycle management description | CIR 2024/2979 | ☐ |
| National eID scheme identification | CIR 2024/2981 | ☐ |
| Threat model + risk register (Annex I categories) | CIR 2024/2981 Annex I | ☐ |

### Phase 2 — Security Documentation

| Document | Based On | Status |
|---|---|---|
| Security policy document | CIR 2024/2981 | ☐ |
| Vulnerability management policy (CRA Annex I aligned) | CIR 2024/2981 Art. ref CRA | ☐ |
| Key management policy (WUA signing keys lifecycle) | EC TS03 + CIR 2024/2981 | ☐ |
| WUA issuance and revocation process doc | EC TS03 V1.0 (Aug 2025) | ☐ |
| Incident response plan | CIR 2024/2981 Annex III | ☐ |
| Change management procedures | CIR 2024/2981 Annex III | ☐ |
| Patch management + flaw remediation procedures | CIR 2024/2981 Annex III | ☐ |
| ISO/IEC 27001 certificate (or equivalent ISMS evidence) | CIR 2024/2981 org requirements | ☐ |

### Phase 3 — Functional Testing Evidence

| Document | Based On | Status |
|---|---|---|
| OpenID4VCI self-certification result (OIDF) | CIR 2024/2982 | ☐ |
| OpenID4VP self-certification result (OIDF) | CIR 2024/2982 | ☐ |
| HAIP 1.0 self-certification result (OIDF) | CIR 2024/2982 | ☐ |
| EWC ITB interoperability test results | ARF 2.5 HLRs | ☐ |
| Pseudonym support test evidence | CIR 2024/2979 | ☐ |
| Selective disclosure test evidence | CIR 2024/2979 | ☐ |
| Consent mechanism test evidence | CIR 2024/2979 | ☐ |
| Audit/event logging test evidence | CIR 2024/2979 | ☐ |
| Data portability test evidence | CIR 2024/2979 | ☐ |
| Credential revocation test evidence | CIR 2024/2979 | ☐ |

### Phase 4 — Member State Notification Package (CIR 2024/2980)

Submitted by the Member State to the Commission. EguWallet must supply:

| Item | Status |
|---|---|
| Wallet provider identity and contact details | ☐ |
| Wallet solution description | ☐ |
| Reference to CAB Certificate of Conformity | ☐ |
| Trust anchor data (WUA public keys for trusted list) | ☐ |
| Supported credential formats (SD-JWT, mdoc) | ☐ |
| Supported protocols (OpenID4VCI, OpenID4VP, HAIP) | ☐ |

---

## Ongoing Post-Certification Obligations

Once the Certificate of Conformity is issued, the Holder Declaration commits you to:

| Obligation | Trigger | Deadline |
|---|---|---|
| Vulnerability Impact Analysis Report | Any discovered vulnerability | Per CAB scheme rules |
| CAB change notification | Architecture / significant software change | Before deployment |
| Public vulnerability disclosure | Publicly known + remediated vulnerabilities | Per CRA / national rules |
| Annual audit evidence | Certificate renewal cycle | Annually |

The Vulnerability Impact Analysis Report must contain:
1. Impact on the certified wallet solution
2. Risk proximity / likelihood assessment
3. Whether vulnerability can be remedied using available means
4. Possible remediation paths

---

## Finding a CAB

National accreditation bodies accredit CABs. For Romania, contact **RENAR** (Romanian Accreditation Association).
ENISA also maintains a cross-border registry:
> https://certification.enisa.europa.eu/take-action/find-conformity-assessment-body_en

For ITSEF (technical security evaluation), look at labs already operating under EUCC/SOG-IS:
- TÜV Informationstechnik (TÜViT)
- SGS-CSTL
- Brightsight
- CCLab (Hungary — closest geographically)

---

## Timeline Summary

| Milestone | Target | Notes |
|---|---|---|
| OIDF self-certification complete | Q1 2026 | 3 specs × ~$700–$3,500 each |
| ARF HLR gap analysis complete | Q1 2026 | Internal — no CAB needed |
| ISO 27001 ISMS scoped + initiated | Q1 2026 | 6–12 month implementation |
| Full documentation package ready | Q2 2026 | All Phase 1–3 docs |
| CAB engaged | Q2 2026 | Allow 4–8 weeks for contracting |
| WSCA Annex IV evaluation starts | Q3 2026 | CAB / ITSEF led |
| WSCD CC evaluation starts | Q3 2026 | ITSEF led — longest item |
| Certificate of Conformity | Q4 2026 | CAB issues after assessment |
| Member State notification | Q4 2026 | Via Romanian MCID or equivalent |
| Certified wallet live | Dec 2026 | Regulatory deadline |