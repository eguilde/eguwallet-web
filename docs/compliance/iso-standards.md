# ISO Standards — eIDAS 2.0 Requirements

> Last updated: 2026-02-24

---

## ISO/IEC 15408 — Common Criteria (CC)

**Role in eIDAS 2.0:** Mandatory for WSCD and WSCA security evaluation.
**EU scheme:** EUCC (EU Cybersecurity Certification Scheme based on Common Criteria)
**Adopted:** Commission Implementing Regulation (EU) 2024/482

### What It Covers

ISO/IEC 15408 is a three-part standard for evaluating IT product security:
- **Part 1** — Introduction and general model
- **Part 2** — Security functional components
- **Part 3** — Security assurance components ← primary for WSCD/WSCA

### Requirements for EguWallet

| Component | Required Assurance Level | Evaluation Method |
|---|---|---|
| WSCD (Hardware SE) | EAL4+ with ALC_DVS.2 + **AVA_VAN.5** | EUCC via accredited ITSEF |
| WSCD (Android StrongBox) | SOG-IS / SESIP evaluation or EUCC | ITSEF or SESIP lab |
| WSCA (Cryptographic App) | AVA_VAN.5 via CIR 2024/2981 Annex IV | CAB / ITSEF |

**AVA_VAN.5** is the highest vulnerability analysis class — it requires a systematic penetration
testing effort against an attacker with high attack potential (extended — methodical). This is
equivalent to the old EAL5 penetration testing requirement.

### Practical Challenges for EguWallet

1. **Composite Evaluation Problem:** The WSCA certificate must reference the exact WSCD version.
   Any WSCD change (new phone model, Android update to TEE) invalidates the WSCA certificate.

2. **Update cycle incompatibility:** Standard CC Flaw Remediation allows minor updates without
   full re-evaluation, but security patches to the WSCA itself require a Flaw Remediation
   maintenance cycle (months, not days).

3. **Protection Profile gap:** A WSCA/WSCD-specific Protection Profile (PP) is being developed
   by CEN TC224 WG17. Until available, evaluators use existing PPs:
   - EN 419 211 series (Secure Signature Creation Devices)
   - GlobalPlatform TEE PP

### Mitigation Strategies

- **GlobalPlatform CSP Configuration** — single applet certification valid across all
  GP-compliant SE platforms. Reduces per-device re-certification burden.
- **SESIP / CEN EN 17927** — faster evaluation path for IoT secure elements.
  Can substitute for full CC in some national schemes.
- **CEN EN 17640:2022** — Fixed-time cybersecurity evaluation methodology.
  Faster alternative accepted by some national schemes.

### Key Resources

- ISO/IEC 15408 standard: https://www.iso.org/standard/72891.html
- EUCC scheme: https://www.enisa.europa.eu/publications/eucc-scheme
- Common Criteria portal: https://www.commoncriteriaportal.org/

---

## ISO/IEC 27001 — Information Security Management System

**Role in eIDAS 2.0:** Not explicitly named in regulations but required indirectly via three routes.
**Status for EguWallet:** ☐ Not yet initiated

### Why It Is Required (Three Routes)

**Route 1 — CIR 2024/2981 Organisational Requirements**
National certification schemes must audit the organisational security posture, including:
- Incident and vulnerability management processes
- Change management processes
- Personnel security
ISO 27001 is the standard evidence package CABs accept for this layer.

**Route 2 — ETSI EN 319 401**
If EguWallet acts as or interfaces with a Trust Service Provider (which it does via eguwallet-qtsp),
ETSI EN 319 401 general requirements apply. These mandate an ISMS equivalent to ISO 27001.

**Route 3 — Cyber Resilience Act Cross-Reference**
CIR 2024/2981 requires holders to maintain a vulnerability management policy per CRA Annex I.
CRA compliance for connected products requires ISO 27001-level operational controls.

> **CABs will not accept ad-hoc security claims** in lieu of a structured ISMS.
> Treat ISO 27001 certification as a prerequisite, not optional.

### Implementation Roadmap for EguWallet

ISO 27001 implementation typically takes 6–12 months for a small team.

| Step | Timeline | Notes |
|---|---|---|
| Define ISMS scope | Q1 2026 | Cover: wallet-provider, qtsp, pid-issuer, key management |
| Gap analysis against ISO 27001:2022 Annex A | Q1 2026 | 93 controls in ISO 27001:2022 |
| Risk assessment + treatment plan | Q1 2026 | Feeds into CIR 2024/2981 Annex I risk register too |
| Implement missing controls | Q1–Q2 2026 | Prioritise those feeding CAB documentation |
| Internal audit | Q2 2026 | Required before certification audit |
| Management review | Q2 2026 | ISO 27001 requirement |
| Stage 1 audit (documentation review) | Q2 2026 | By accredited certification body |
| Stage 2 audit (implementation audit) | Q3 2026 | On-site / remote |
| ISO 27001 certificate issued | Q3 2026 | Valid 3 years with annual surveillance audits |

### Synergy with eIDAS Documentation

Many ISO 27001 deliverables directly feed eIDAS 2.0 CAB documentation:

| ISO 27001 Deliverable | eIDAS 2.0 Document |
|---|---|
| Risk assessment | Threat model + risk register (CIR 2024/2981 Annex I) |
| Information security policy | Security policy document |
| Incident management procedure | Incident response plan |
| Change management procedure | Change management procedures |
| Vulnerability management procedure | Vulnerability management policy (CRA Annex I) |
| Access control policy | Key management policy (partial) |
| Asset inventory | System architecture doc (partial) |

---

## ISO/IEC 18013-5 — Mobile Driving License (Proximity)

**Role in eIDAS 2.0:** Mandatory credential format for proximity (in-person) presentation flows.
**Format:** mdoc / CBOR — defined by ISO 18013-5
**Status for EguWallet:** ☐ Assess current implementation

### What It Covers

ISO 18013-5 defines the data model, encoding (CBOR), and device engagement/session protocols
for Mobile Driving License (mDL) presentation. In the EUDI context it is used as the **mdoc**
credential format for face-to-face / proximity use cases.

### Key Technical Requirements

| Requirement | Detail |
|---|---|
| Credential format | CBOR-encoded mdoc |
| Device engagement | QR code or NFC |
| Session encryption | ECDH with session transcript |
| Selective disclosure | Namespace + data element level |
| Holder binding | Device-signed `DeviceAuth` in response |
| Reader authentication | Optional, recommended for LoA High |

### EguWallet Applicability

- **Online flows** (remote presentation): Covered by **ISO 18013-7** (extension of 18013-5 for
  online use), implemented via OpenID4VP with mdoc format.
- **Proximity flows** (in-person, e.g., document checks): Full ISO 18013-5 BLE/NFC required.
  Assess whether eguwallet-android currently implements BLE/NFC device engagement.

### Key Resources

- ISO 18013-5: https://www.iso.org/standard/69084.html
- ISO 18013-7 (online): https://www.iso.org/standard/82772.html
- EUDI mdoc implementation reference: https://github.com/eu-digital-identity-wallet/eudi-lib-android-iso18013-data-model

---

## ISO/IEC 29003 — Identity Proofing

**Role in eIDAS 2.0:** Required for PID issuers and QEAA providers performing identity
verification. NOT directly required for the wallet application itself.

**Applicability to EguWallet:**
- `backend/src/pid-issuer/` — the PID issuer must comply with ISO 29003 / ETSI TS 119 461
- `eguwallet-qtsp` — if issuing QEAAs that require identity proofing

### What It Covers

ISO 29003 defines requirements and recommendations for identity proofing — the process of
verifying that a person is who they claim to be before issuing credentials.

Relevant claims (LoA mapping):
- **LoA Substantial:** Remote identity proofing with document + liveness check
- **LoA High:** In-person or equivalent remote proofing with NFC chip reading

### Key Resources

- ISO 29003: https://www.iso.org/standard/73826.html
- ETSI TS 119 461 v2.1.1 (Feb 2025) — more specific, directly cited by CIR 2024/2983:
  https://www.etsi.org/deliver/etsi_ts/119400_119499/119461/02.01.01_60/ts_119461v020101p.pdf