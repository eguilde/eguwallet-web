# EGUWallet Conformance Testing Guide

## Overview

This guide explains how to run the [EWC ITB Conformance Backend](https://github.com/EWC-consortium/ewc-wallet-conformance-backend) against the eguwallet stack to verify OID4VCI (credential issuance) and OID4VP (credential presentation) compliance.

The conformance backend acts as both:
- **Issuer**: issues test PID/QEAA credentials via OID4VCI
- **Verifier**: requests credential presentations via OID4VP

---

## Local Setup

### 1. Clone and install

```bash
git clone https://github.com/EWC-consortium/ewc-wallet-conformance-backend.git /c/dev/ewc-wallet-conformance-backend
cd /c/dev/ewc-wallet-conformance-backend
npm install
```

### 2. Configure server URL

The `SERVER_URL` env var must be publicly accessible so the wallet can redirect back:

```bash
# Option A: local test with ngrok tunnel
ngrok http 3000
export SERVER_URL="https://<ngrok-id>.ngrok.io"

# Option B: deploy to egucluster3 at conformance.eguwallet.eu
export SERVER_URL="https://conformance.eguwallet.eu"
```

### 3. Start the backend

```bash
SERVER_URL="https://conformance.eguwallet.eu" node server.js
```

Starts on port 3000. Key endpoints:
- `/.well-known/openid-credential-issuer` — credential issuer metadata
- `/.well-known/oauth-authorization-server` — AS metadata
- `GET /offer-no-code` — pre-authorized credential offer (no transaction code)
- `GET /offer-tx-code` — pre-authorized offer with 6-digit PIN
- `GET /vp-request/pid` — OpenID4VP request for PID presentation

---

## Testing the eguwallet Android App

### Credential Issuance (OID4VCI)

Use the wallet client bundled in `wallet-client/` to simulate what the Android app does:

```bash
cd wallet-client
npm install

# Test pre-authorized PID issuance (no PIN)
node src/index.js \
  --issuer http://localhost:3000 \
  --fetch-offer /offer-no-code \
  --credential VerifiablePIDSDJWT

# Test with PIN (tx_code)
node src/index.js \
  --issuer http://localhost:3000 \
  --fetch-offer /offer-tx-code \
  --credential VerifiablePIDSDJWT \
  --tx-code 123456
```

### Credential Presentation (OID4VP)

```bash
# PID presentation (SD-JWT)
node src/index.js \
  --verifier http://localhost:3000 \
  --vp-request /vp-request/pid \
  --credential VerifiablePIDSDJWT
```

---

## Testing Against Live eguwallet Stack

Our production services at `eguwallet.eu`:

| Service | URL | Purpose |
|---------|-----|---------|
| wallet-provider | https://wallet.eguwallet.eu | Wallet backend |
| qtsp | https://qtsp.eguwallet.eu | Certificate authority |
| lotl | https://lotl.eguwallet.eu | Trusted list |
| certification | https://cert.eguwallet.eu | CAB |
| dgep | https://dgep.eguwallet.eu | QEAA/PID issuer |

### Test OID4VCI flow end-to-end

1. Start conformance backend with public URL
2. Generate a credential offer:
   ```
   curl "https://conformance.eguwallet.eu/offer-no-code?credentialType=urn:eu.europa.ec.eudi:pid:1&sessionId=test1&signatureType=x509"
   ```
3. Scan QR code / deep link with eguwallet Android app
4. App completes issuance flow against conformance issuer
5. Check session logs: `GET https://conformance.eguwallet.eu/log/session/test1`

### Test OID4VP flow end-to-end

1. Generate a VP request:
   ```
   curl "https://conformance.eguwallet.eu/vp-request/pid?sessionId=test2"
   ```
2. Present to Android app — app redirects to verifier
3. Check result: `GET https://conformance.eguwallet.eu/log/session/test2`

---

## Docker Deployment to egucluster3

```bash
# On egucluster3
mkdir -p /opt/eguilde/ewc-conformance
cd /opt/eguilde/ewc-conformance

cat > docker-compose.yml <<'EOF'
version: '3'
services:
  ewc-conformance:
    image: ghcr.io/ewc-consortium/ewc-wallet-conformance-backend:latest
    container_name: ewc-conformance
    environment:
      SERVER_URL: https://conformance.eguwallet.eu
    ports:
      - "3020:3000"
    restart: unless-stopped
EOF

docker compose up -d
```

Add nginx proxy to egucluster1 for `conformance.eguwallet.eu → egucluster3:3020`.

---

## Key Test Cases Covered

| Test | Endpoint | Protocol |
|------|----------|----------|
| PID issuance (pre-auth) | `/offer-no-code` | OID4VCI |
| PID issuance with PIN | `/offer-tx-code` | OID4VCI |
| PID issuance (code flow) | `/vci/offer?flow=authorization_code` | OID4VCI |
| PID presentation | `/vp-request/pid` | OID4VP |
| e-Passport presentation | `/vp-request/epassport` | OID4VP |
| mDL presentation | `/vp-request/mdl` | OID4VP |
| x509 SAN client auth | `/x509/VPrequest/:id` | OID4VP |
| Verifier attestation | `/verifier-attestation/*` | OID4VP |

---

## Automated Conformance Tests

The backend includes a Jest test suite:

```bash
cd /c/dev/ewc-wallet-conformance-backend
npm test
```

Tests cover: metadata discovery, SD-JWT issuance flows, VP request generation, and CRL/OCSP integration.

---

## See Also

- [ARF HLR Compliance Checklist](./compliance/arf-hlr-checklist.md)
- [EUDI Wallet ARF 2.5.0](https://github.com/eu-digital-identity-wallet/eudi-doc-architecture-and-reference-framework)
- [EWC RFC-001 Issue Verifiable Credential](https://github.com/EWC-consortium/eudi-wallet-rfcs/blob/main/ewc-rfc001-issue-verifiable-credential.md)
