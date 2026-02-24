# eIDAS 2.0 Proximity Presentation — Design Document

**Date:** 2026-02-23
**Scope:** BLE/NFC proximity credential presentation for EguWallet ecosystem
**Status:** Approved

## Overview

Enable eIDAS 2.0 compliant proximity credential presentation (ISO 18013-5) across three components:

1. **eguwallet-android** (holder) — present credentials via BLE/NFC to verifier devices
2. **eguwallet-android-verifier** (new app) — verify credentials from holder wallets via BLE/NFC
3. **eguwallet-dgep** (PID issuer) — ensure mdoc issuance works end-to-end with holder binding

## Current State

### eguwallet-android
- Two parallel BLE/NFC implementations exist (both ~60-75% skeleton)
- All crypto stubbed: ECDH returns zeros, encryption passes plaintext, CBOR encoding not implemented
- `AndroidWSCD` (key management) is 95% production-ready
- `DocumentManager`, `HardwareSecuredDocumentStorage` work well
- `OpenID4VPManager` handles remote presentation (SD-JWT)
- `MdocParser`, `MdocCredentialManager`, `MdocPresentationBuilder` exist but incomplete
- Manifest already declares all BLE/NFC permissions

### eguwallet-dgep
- `MdocService` (807 lines) fully implements ISO 18013-5 CBOR encoding, COSE_Sign1, MSO
- Credential controller already accepts `mso_mdoc` format requests
- Device key binding method exists (`bindDeviceKey`)
- OpenID4VCI metadata lists both `dc+sd-jwt` and `mso_mdoc` formats
- Tests include mdoc scenarios

### What's missing
- Working proximity transport (the existing stubs don't function)
- Proper mdoc credential request flow in the Android wallet (defaults to SD-JWT)
- A verifier application
- End-to-end integration testing

## Architecture

### Library Strategy

Use EU Commission reference libraries — they handle all ISO 18013-5 protocol internals:

| Component | Library | Version | Role |
|-----------|---------|---------|------|
| Holder transport | `eu.europa.ec.eudi:eudi-lib-android-iso18013-data-transfer` | 0.11.0 | BLE peripheral, NFC HCE, session encryption, CBOR |
| Verifier SDK | `eu.europa.ec.eudi:eudi-lib-android-verifier-core` | 0.1.0 | BLE central, request/response, MSO validation |

These libraries handle internally:
- ECDH key agreement (P-256)
- HKDF-SHA256 session key derivation
- AES-256-GCM session encryption
- CBOR encoding/decoding (DeviceEngagement, DeviceRequest, DeviceResponse)
- MSO signature verification
- Device authentication verification
- BLE GATT server/client lifecycle
- NFC HCE + NDEF handover

### Dependency chain

```
eguwallet-android (holder)
  └── eudi-lib-android-iso18013-data-transfer (0.11.0)
        └── org.multipaz:multipaz-android (internal dep)

eguwallet-android-verifier (verifier)
  └── eudi-lib-android-verifier-core (0.1.0)
        └── org.multipaz:multipaz-android (internal dep)
```

## Part 1: Holder App (eguwallet-android)

### Files to DELETE (stubbed, non-functional)

```
data/transfer/BleTransferService.kt        — replaced by EUDI TransferManager
data/transfer/NfcTransferService.kt        — replaced by EUDI NfcEngagementService
data/transfer/DataTransferManager.kt       — replaced by ProximityPresentationManager
protocols/proximity/BlePresentationManager.kt  — replaced
protocols/proximity/NfcPresentationManager.kt  — replaced
```

### Files to CREATE

```
domain/proximity/ProximityPresentationManager.kt
  — Wraps EUDI TransferManager
  — Configures BLE peripheral mode + NFC engagement
  — Exposes TransferEvent as Kotlin Flow
  — Bridges to existing credential storage via EudiDocumentManagerBridge

domain/proximity/EudiDocumentManagerBridge.kt
  — Implements EUDI DocumentManager interface
  — Delegates to existing DocumentManager + UnifiedCredentialManager
  — Maps stored credentials to EUDI Document format

services/WalletNfcEngagementService.kt
  — Extends EUDI NfcEngagementService (abstract Android Service)
  — Provides TransferManager instance for NFC tap engagement
  — Registered in AndroidManifest.xml with HOST_APDU_SERVICE intent

ui/screens/ProximityPresentationScreen.kt
  — QR code display (device engagement)
  — "Or tap NFC" instruction
  — Attribute consent checkboxes (from RequestReceived event)
  — PIN/biometric gate before sending
  — Success/error status

viewmodels/ProximityPresentationViewModel.kt
  — Manages TransferManager lifecycle
  — Processes TransferEvent sealed class
  — Builds DisclosedDocuments from user selections
```

### Files to MODIFY

```
build.gradle.kts
  — Add: implementation("eu.europa.ec.eudi:eudi-lib-android-iso18013-data-transfer:0.11.0")
  — Add Sonatype snapshot repo if needed

AndroidManifest.xml
  — Add WalletNfcEngagementService with HOST_APDU_SERVICE intent filter
  — Add nfc_engagement_apdu_service.xml resource

di/DomainModule.kt
  — Provide ProximityPresentationManager, EudiDocumentManagerBridge

compliance/ARFComplianceManager.kt
  — Update checkISO18013Support() and checkMdocSupport() to return true

protocols/openid/OpenID4VCIManager.kt
  — Request BOTH dc+sd-jwt AND mso_mdoc credentials during issuance
  — Store mdoc alongside SD-JWT for same PID
```

### Holder proximity flow

```
1. User taps "Present in person"
2. ProximityPresentationManager.startQrEngagement()
3. Screen shows QR code containing BLE DeviceEngagement
4. (Alternative: NFC tap via WalletNfcEngagementService)
5. Verifier scans QR → BLE connection established
6. TransferEvent.RequestReceived → show consent UI
   - List requested attributes with toggles
   - Verifier identity (if reader cert is trusted)
7. User selects attributes + PIN/biometric auth
8. ProximityPresentationManager.sendResponse(disclosedDocuments)
9. TransferEvent.ResponseSent → success screen
```

## Part 2: Verifier App (eguwallet-android-verifier)

### New Android project

```
Package: com.eguwallet.verifier
Application ID: verifier.eguwallet.com
Min SDK: 30 (same as wallet)
Target SDK: 35
Tech stack: Kotlin 2.1.0, Jetpack Compose, Material 3, Hilt
```

### Project structure

```
eguwallet-android-verifier/
├── app/src/main/java/com/eguwallet/verifier/
│   ├── VerifierApplication.kt               — Hilt application
│   ├── MainActivity.kt                      — Single activity, Compose
│   │
│   ├── domain/
│   │   ├── VerificationManager.kt           — Wraps EudiVerifier + TransferManager
│   │   ├── TrustAnchorProvider.kt           — Loads IACA certs from resources
│   │   ├── RequestTemplates.kt              — Pre-built DocRequest for PID, mDL, etc.
│   │   └── VerificationResult.kt            — Result model with trust/validity info
│   │
│   ├── ui/
│   │   ├── screens/
│   │   │   ├── HomeScreen.kt                — "Verify Identity" + recent history
│   │   │   ├── SelectRequestScreen.kt       — Choose what to verify
│   │   │   ├── ScanScreen.kt                — Camera for QR scanning
│   │   │   ├── WaitingScreen.kt             — "Waiting for holder..."
│   │   │   └── ResultScreen.kt              — Validated attributes + trust indicators
│   │   ├── components/
│   │   │   ├── AttributeRow.kt              — Single verified attribute display
│   │   │   └── TrustBadge.kt                — Issuer trust indicator
│   │   └── theme/
│   │       └── VerifierTheme.kt             — Same visual style as wallet
│   │
│   ├── viewmodels/
│   │   └── VerificationViewModel.kt         — Lifecycle + state management
│   │
│   ├── di/
│   │   └── AppModule.kt                     — Hilt providers
│   │
│   └── navigation/
│       └── NavigationGraph.kt
│
├── app/src/main/res/
│   ├── raw/
│   │   └── iaca_root_cert.pem               — IACA trust anchors
│   └── xml/
│       └── ...
│
├── app/build.gradle.kts
└── settings.gradle.kts
```

### Verifier flow

```
1. Inspector opens verifier app, taps "Verify Identity"
2. Selects request template (e.g., "Full PID", "Age Only", "mDL")
3. Camera opens → scans holder's QR code
4. BLE connection established (verifier = central)
5. DeviceRequest sent automatically
6. TransferEvent.ResponseReceived → validate:
   - MSO issuer signature (COSE_Sign1 chain → IACA)
   - Device authentication (holder key possession)
   - Data integrity (per-element digest verification)
   - Certificate trust (IACA root in trust store)
   - Validity period (MSO validFrom/validUntil)
7. Display results:
   - Green: verified attributes with values
   - Trust badge: issuer identity
   - Warnings: if any validation fails
```

### Request templates

```kotlin
object RequestTemplates {
    val fullPid = DocRequest(
        docType = "eu.europa.ec.eudi.pid.1",
        itemsRequest = mapOf(
            "eu.europa.ec.eudi.pid.1" to mapOf(
                "family_name" to false,
                "given_name" to false,
                "birth_date" to false,
                "age_over_18" to false,
                "nationality" to false,
                "issuing_authority" to false,
                "issuing_country" to false
            )
        )
    )

    val ageOnly = DocRequest(
        docType = "eu.europa.ec.eudi.pid.1",
        itemsRequest = mapOf(
            "eu.europa.ec.eudi.pid.1" to mapOf(
                "age_over_18" to false
            )
        )
    )

    val mDL = DocRequest(
        docType = "org.iso.18013.5.1.mDL",
        itemsRequest = mapOf(
            "org.iso.18013.5.1" to mapOf(
                "family_name" to false,
                "given_name" to false,
                "document_number" to false,
                "portrait" to false,
                "driving_privileges" to false,
                "issue_date" to false,
                "expiry_date" to false
            )
        )
    )
}
```

## Part 3: PID Issuer (eguwallet-dgep)

### Already implemented
- `MdocService.issuePidMdoc()` — full ISO 18013-5 CBOR encoding
- `MdocService.bindDeviceKey()` — device key binding post-issuance
- Credential controller routes `mso_mdoc` requests correctly
- OpenID4VCI metadata lists `mso_mdoc` format

### Changes needed

1. **Dual-format issuance** — When wallet requests PID, issue BOTH formats:
   - Modify `CredentialIssuanceService` to support batch response
   - Or: wallet makes two requests (one `dc+sd-jwt`, one `mso_mdoc`)
   - Recommended: wallet makes two separate credential requests (simpler, spec-compliant)

2. **Device key binding at issuance** — Currently `bindDeviceKey` is a post-issuance step.
   The wallet's proof-of-possession JWT already contains the holder's JWK.
   Ensure the mdoc MSO's `deviceKeyInfo.deviceKey` is set to the holder's key from the proof JWT during initial issuance (not as a separate step).

3. **IACA certificate** — The verifier needs to trust the issuer's certificate chain.
   Export the IACA root certificate (or self-signed QTSP cert) for bundling in the verifier app's trust store.

## Credential Format by Presentation Mode

| Scenario | Protocol | Format | Library |
|----------|----------|--------|---------|
| Proximity (BLE/NFC) | ISO 18013-5 | mdoc (CBOR) | eudi-iso18013-data-transfer |
| Remote (online) | OpenID4VP | SD-JWT VC | Existing OpenID4VPManager |
| Same-device | Android CredentialManager | Either | Future enhancement |

## Offline Capability

The entire proximity flow works **fully offline** (eIDAS 2.0 requirement):
- QR code contains all engagement data (no network needed)
- BLE is direct device-to-device
- MSO validation uses bundled IACA certificates
- No internet required on either holder or verifier side

## Security Properties

| Property | Mechanism |
|----------|-----------|
| Session encryption | ECDH (P-256) + HKDF-SHA256 + AES-256-GCM |
| Issuer authentication | COSE_Sign1 over MSO, ES256, cert chain → IACA |
| Device authentication | Holder signs SessionTranscript with hardware-bound key |
| Selective disclosure | Per-element: only requested+consented IssuerSignedItems sent |
| Replay prevention | Ephemeral keys per session, SessionTranscript binding |
| Credential cloning prevention | Device key in TEE/StrongBox, Android key attestation |

## Implementation Order

1. **eguwallet-dgep**: Verify mdoc issuance works with device key binding (small change)
2. **eguwallet-android**: Integrate EUDI data-transfer lib, dual-format issuance, proximity UI
3. **eguwallet-android-verifier**: New project with EUDI verifier-core
4. **Integration testing**: Holder ↔ Verifier proximity flow end-to-end
