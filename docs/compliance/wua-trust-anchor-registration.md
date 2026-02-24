# WUA Trust Anchor Registration — Governance Procedure

> ARF HLR: WUA-05, TF-03 | Priority: P3 (Governance)
> Last updated: 2026-02-24

---

## Overview

Per eIDAS 2.0 ARF §6.5.3 and EC TS03 V1.0, the Wallet Provider must register its WUA signing
key (trust anchor public key) in the relevant **national trusted list (NTL)** operated by the
Romanian national supervisory body (NSB). This enables Relying Parties and Credential Issuers
to independently verify Wallet Unit Attestations without relying on the wallet gateway.

---

## Current State

| Item | Status |
|---|---|
| WP signing key exists | ✅ — `WalletProviderKeyManagementService` manages EC P-256 key |
| JWKS endpoint live | ✅ — `GET https://wallet.eguwallet.eu/.well-known/jwks` |
| WP certificate issued by QTSP | ✅ — `eguwallet-qtsp` CA issues WP certificate on bootstrap |
| National trusted list entry | ❌ — **Not yet submitted** |
| LOTL (European list of lists) entry | ❌ — Depends on NTL entry |

---

## Required Steps

### Step 1 — Obtain QTSP-Issued Certificate (Technical)

The WP signing certificate must be issued by an **EU-qualified QTSP** (not the internal
`eguwallet-qtsp` for national list purposes — a third-party accredited QTSP is needed for
production). For the initial national trusted list submission:

```
Responsible: System Administrator / Legal Representative
Certificate subject: CN=eGuWallet Wallet Provider, O=Eguilde SRL, C=RO
Key algorithm: EC P-256 (NIST P-256)
Certificate validity: 2 years
Required extensions: keyUsage=digitalSignature, extendedKeyUsage=id-kp-OCSPSigning
```

### Step 2 — Export WP Public Key JWKS

Export the current WP JWKS from the live endpoint for inclusion in the NTL entry:

```bash
curl -s https://wallet.eguwallet.eu/.well-known/jwks | jq .
```

### Step 3 — Prepare TSL Entry (ETSI TS 119 612 format)

The national trusted list entry for the Wallet Provider should include:

```xml
<TrustServiceProvider>
  <TSPName>
    <Name xml:lang="ro">Eguilde SRL — Wallet Provider</Name>
    <Name xml:lang="en">Eguilde SRL — Wallet Provider</Name>
  </TSPName>
  <TSPTradeName>
    <Name xml:lang="ro">eGuWallet</Name>
  </TSPTradeName>
  <TSPAddress>
    <!-- Legal address of Eguilde SRL -->
  </TSPAddress>
  <TSPInformationURI>
    <URI xml:lang="en">https://wallet.eguwallet.eu</URI>
  </TSPInformationURI>
  <TSPServices>
    <TSPService>
      <ServiceTypeIdentifier>
        http://uri.etsi.org/TrstSvc/Svctype/EUDIWalletProvider
      </ServiceTypeIdentifier>
      <ServiceName>
        <Name xml:lang="en">eGuWallet — EUDI Wallet Unit Attestation Issuer</Name>
      </ServiceName>
      <ServiceDigitalIdentity>
        <!-- X509 certificate of WP signing key (DER base64) -->
        <DigitalId>
          <X509Certificate>MIIB...</X509Certificate>
        </DigitalId>
        <!-- Also include JWK for verifiers that use JWKS -->
        <DigitalId>
          <Other>
            <X509SubjectName>CN=eGuWallet Wallet Provider, O=Eguilde SRL, C=RO</X509SubjectName>
          </Other>
        </DigitalId>
      </ServiceDigitalIdentity>
      <ServiceStatus>
        http://uri.etsi.org/TrstSvc/TrustedList/Svcstatus/granted
      </ServiceStatus>
      <StatusStartingTime>2026-01-01T00:00:00Z</StatusStartingTime>
      <ServiceInformationExtensions>
        <Extension Critical="false">
          <AdditionalServiceInformation>
            <URI xml:lang="en">https://wallet.eguwallet.eu/.well-known/openid-wallet-issuer</URI>
          </AdditionalServiceInformation>
        </Extension>
      </ServiceInformationExtensions>
    </TSPService>
  </TSPServices>
</TrustServiceProvider>
```

### Step 4 — Submit to Romanian NSB

Romanian national supervisory body for eIDAS: **MCID** (Ministerul Cercetării, Inovării și
Digitalizării) — Digital Signature and Trust Services department.

Submission package:
- [ ] Legal application form (MCID-TSP-01)
- [ ] TSL entry in ETSI TS 119 612 XML format (Step 3)
- [ ] WP signing certificate in DER format
- [ ] QTSP certificate chain for WP certificate
- [ ] Technical description of wallet attestation process (can reference ARF compliance docs)
- [ ] Privacy policy + terms of service URLs
- [ ] Contact details for eIDAS notification service

**Contact:** mcid.gov.ro/servicii-digitale/semnaturi-electronice

### Step 5 — Update eguwallet-lotl to Include WP Entry

Once NTL entry is confirmed by MCID, update `eguwallet-lotl` to include the WP entry in the
local trusted list XML served at `GET /api/lotl/trusted-list.xml`. This enables the verifier
`TrustService.verifyIssuerTrust()` to find the WP without calling the wallet gateway.

### Step 6 — Configure Verifiers to Use National List

Update `backend/src/verifier/trust.service.ts`:
- Add MCID national list URL to `TRUSTED_LIST_URLS` config
- Alternatively, the wallet gateway (`/api/lotl/verify-issuer`) already delegates to the
  national list, so this may be automatic once the NTL entry is live

---

## Key Material

Current WP JWKS endpoint (for reference): `https://wallet.eguwallet.eu/.well-known/jwks`

The WP signing key is managed by `WalletProviderKeyManagementService` in `eguwallet-wallet-provider`.
Certificate chain is fetched from `eguwallet-qtsp` on bootstrap. The certificate at
`GET https://cert.eguwallet.eu/api/wp-cert` should be submitted to MCID.

---

## Timeline Estimate

| Step | Owner | Estimated Duration |
|---|---|---|
| Obtain production QTSP certificate | Legal + IT | 2–4 weeks |
| Prepare TSL entry | IT | 1 day |
| Submit to MCID | Legal | 1 day submission; 4–12 weeks review |
| Update lotl service | IT | 1 day (after MCID confirms) |
| **Total to NTL entry** | | **~3–4 months** |

---

## References

- eIDAS 2.0 Regulation (EU) 2024/1183, Art. 8a — Trusted Lists
- ARF §6.5.3 — Wallet Provider registration
- ETSI TS 119 612 v2.1.1 — Trusted Lists format
- EC TS03 V1.0 §4.3 — WP trust anchor registration
- Romanian MCID trusted list: https://eid.gov.ro/tsl/tsl.xml
