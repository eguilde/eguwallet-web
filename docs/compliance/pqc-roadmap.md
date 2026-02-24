# Post-Quantum Cryptography Roadmap — EguWallet

> Last updated: 2026-02-24
> Status: Planning phase
> Target: Hybrid PQC mode by 2028 (migration window before EU mandate ~2029)

---

## Current Algorithm Inventory

| Component | Algorithm | Key Size | Usage |
|---|---|---|---|
| WUA signing | ES256 (ECDSA P-256) | 256-bit | Wallet attestation JWT |
| RP key pair | ES256 (ECDSA P-256) | 256-bit | Authorization requests |
| SD-JWT signing | ES256 (ECDSA P-256) | 256-bit | PID credential signing |
| KB-JWT | ES256 (ECDSA P-256) | 256-bit | Holder binding |
| JARM | ECDH-ES + A256GCM | 256-bit | VP response encryption |
| Backup | AES-256-GCM + PBKDF2 | 256-bit | Wallet backup encryption |
| Trust chain | RS256 (RSA-2048) | 2048-bit | Fallback issuer verification |
| Status list | GZIP + base64url | — | RFC 9427 Token Status List |

All current algorithms comply with ENISA / SOG-IS 2025 recommendations.
No SHA-1, no RSA <2048, no legacy curves (P-192, brainpool).

---

## Standards Timeline

| Standard | Status | Relevance |
|---|---|---|
| NIST FIPS 203 (ML-KEM / Kyber) | **Final** (Aug 2024) | Key encapsulation — replaces ECDH-ES |
| NIST FIPS 204 (ML-DSA / Dilithium) | **Final** (Aug 2024) | Digital signatures — replaces ECDSA |
| NIST FIPS 205 (SLH-DSA / SPHINCS+) | **Final** (Aug 2024) | Hash-based signatures — backup option |
| ETSI/CEN 319-series PQC updates | In progress (2025–2027) | Will update eIDAS trust service standards |
| ENISA PQC migration guidance | Published 2024 | Target: organizations complete PQC migration by 2030 |
| SOG-IS PQC algorithm update | Expected 2026–2027 | Will mandate PQC-capable algorithms |

---

## Migration Strategy

### Phase 1 — Inventory and Readiness (2026)
- [ ] Audit all cryptographic dependencies for PQC-readiness
- [ ] Evaluate `jose` (JavaScript) and `nimbus-jose-jwt` (Android) PQC support
- [ ] Identify WSCD/WSCA hardware PQC capability (StrongBox TEE roadmap)
- [ ] Monitor ETSI/CEN 319-series PQC draft publication

### Phase 2 — Hybrid Mode Implementation (2027)
- [ ] Implement hybrid signatures: ES256 + ML-DSA (Dilithium3) in parallel
- [ ] Hybrid key encapsulation: ECDH-ES + ML-KEM-768 for JARM
- [ ] Update WUA JWT to include hybrid signature
- [ ] Update `.well-known` metadata to advertise PQC-capable algorithms

### Phase 3 — Full PQC Migration (2028)
- [ ] Switch primary signing to ML-DSA (keep ES256 as backward-compat fallback)
- [ ] Remove RSA-2048 fallback (if no longer required by ETSI/CEN)
- [ ] Update all credential formats to PQC-primary
- [ ] PQC certification: engage ITSEF for re-evaluation of cryptographic modules

---

## Affected Components by Algorithm

| New Algorithm | Replaces | Affected Components |
|---|---|---|
| ML-DSA (Dilithium3) | ES256 (ECDSA P-256) | WUA signing, RP key pair, SD-JWT signing, KB-JWT |
| ML-KEM-768 (Kyber) | ECDH-ES | JARM encryption, future credential issuance key wrapping |
| SHA3-256 (SHAKE256) | SHA-256 | SD-JWT disclosure digests, KB-JWT sd_hash |

---

## Key Dependencies to Watch

- **Android StrongBox**: Google roadmap for ML-DSA/ML-KEM in StrongBox TEE
- **jose (npm)**: PQC support not yet available — monitor [@panva/jose](https://github.com/panva/jose)
- **nimbus-jose-jwt**: PQC experimental support expected 2026
- **ETSI TS 119 182-x series**: New JAdES PQC profile under development

---

## References

- [NIST PQC Standards](https://csrc.nist.gov/projects/post-quantum-cryptography/post-quantum-cryptography-standardization)
- [ENISA PQC Migration Guidelines](https://www.enisa.europa.eu/publications/post-quantum-cryptography)
- [ETSI/CEN Workshop PQC for eIDAS (2025)](https://docbox.etsi.org/esi/Open/workshops/)
- [eIDAS 2.0 cryptography requirements](https://eu-digital-identity-wallet.github.io/eudi-doc-architecture-and-reference-framework/2.5.0/)
