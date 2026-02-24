# eIDAS 2.0 Proximity Presentation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable eIDAS 2.0 compliant proximity credential presentation (ISO 18013-5) via BLE/NFC across three components: holder wallet, new verifier app, and PID issuer backend.

**Architecture:** Use EU Commission reference libraries (`eudi-lib-android-iso18013-data-transfer` for holder, `eudi-lib-android-verifier-core` for verifier) which handle all ISO 18013-5 internals (ECDH, HKDF, AES-GCM, CBOR, MSO). Replace existing custom BLE/NFC stubs. Wallet requests mdoc format alongside SD-JWT during PID issuance.

**Tech Stack:** Kotlin 2.1.0, Jetpack Compose, Hilt DI, EUDI reference libraries, NestJS (backend), ISO 18013-5, CBOR, COSE_Sign1

**Design Doc:** `docs/plans/2026-02-23-eidas2-proximity-presentation-design.md`

**Repos:**
- `/c/dev/eguwallet-dgep` — PID issuer (NestJS)
- `/c/dev/eguwallet-android` — Holder wallet (Android)
- `/c/dev/eguwallet-android-verifier` — Verifier app (new Android project)

---

## Workstream 1: PID Issuer — mdoc Device Key Binding Fix

### Task 1.1: Fix mdoc issuance to bind holder's device key at issuance time

**Context:** The `MdocService.issuePidMdoc()` currently does NOT receive the holder's public key from the proof-of-possession JWT. The MSO's `deviceKeyInfo.deviceKey` is set to the issuer's key instead of the holder's. The `bindDeviceKey()` method exists but is never called during the standard issuance flow. The fix is to pass the holder's JWK through to `issuePidMdoc()` and set it as the device key in the MSO.

**Files:**
- Modify: `/c/dev/eguwallet-dgep/apps/dgep/src/services/credential-issuance.service.ts`
- Modify: `/c/dev/eguwallet-dgep/apps/dgep/src/services/mdoc.service.ts`
- Test: `/c/dev/eguwallet-dgep/apps/dgep/src/services/credential-issuance.service.spec.ts`

**Step 1: Modify `credential-issuance.service.ts` to pass holder JWK to mdoc issuance**

In the `handleCredentialRequest()` method, find the mdoc branch (around line 128) and pass `holderJwk`:

```typescript
// BEFORE (current):
const mdocResult = await this.mdocService.issuePidMdoc(
  { /* ... pidData ... */ },
  issuerKey,
);

// AFTER (add holderJwk parameter):
const mdocResult = await this.mdocService.issuePidMdoc(
  { /* ... pidData ... */ },
  issuerKey,
  holderJwk,  // <-- pass holder's public key from proof-of-possession
);
```

**Step 2: Modify `mdoc.service.ts` to accept and use holder key**

Update `issuePidMdoc()` signature to accept optional `holderPublicKeyJwk`:

```typescript
async issuePidMdoc(pidData: { /* existing params */ }, issuerKey: {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  keyId: string;
}, holderPublicKeyJwk?: any): Promise<{ success: boolean; mdoc?: Buffer; docType?: string; error?: string; }>
```

In `buildIssuerSigned()` (or wherever the MSO's `deviceKeyInfo` is set), use the holder's key when available:

```typescript
// In MSO construction — use holder's device key instead of issuer's
const deviceKey = holderPublicKeyJwk
  ? this.jwkToCoseKey(holderPublicKeyJwk)
  : this.ecPublicKeyToCoseKey(issuerKey.publicKey);
```

Add the `jwkToCoseKey()` helper that converts a JWK `{ kty: "EC", crv: "P-256", x: "...", y: "..." }` to a COSE_Key map:

```typescript
private jwkToCoseKey(jwk: any): Map<number, any> {
  const coseKey = new Map<number, any>();
  coseKey.set(1, 2);  // kty: EC2
  coseKey.set(-1, 1); // crv: P-256
  coseKey.set(-2, Buffer.from(jwk.x, 'base64url')); // x coordinate
  coseKey.set(-3, Buffer.from(jwk.y, 'base64url')); // y coordinate
  return coseKey;
}
```

**Step 3: Update existing tests**

Update the mdoc issuance test in `credential-issuance.service.spec.ts` to pass a mock holder JWK and verify it appears in the issued mdoc's MSO deviceKeyInfo.

**Step 4: Run tests**

```bash
cd /c/dev/eguwallet-dgep && npm test -- --testPathPattern=credential-issuance
```

**Step 5: Commit**

```bash
cd /c/dev/eguwallet-dgep
git add apps/dgep/src/services/credential-issuance.service.ts apps/dgep/src/services/mdoc.service.ts apps/dgep/src/services/credential-issuance.service.spec.ts
git commit -m "fix: bind holder device key in mdoc MSO at issuance time"
```

### Task 1.2: Fix credential controller to accept `mso_mdoc` format

**Context:** The `CredentialController` DTO validates only `dc+sd-jwt` and `vc+sd-jwt` formats. The `mso_mdoc` format is blocked by the DTO validation and the controller's format check. The `CredentialIssuanceService` already handles it, but the request never gets there.

**Files:**
- Modify: `/c/dev/eguwallet-dgep/apps/dgep/src/controllers/credential.controller.ts`

**Step 1: Update CredentialRequestDto to accept mso_mdoc**

```typescript
// BEFORE:
class CredentialRequestDto implements CredentialRequest {
  @IsString()
  @IsNotEmpty()
  format: 'dc+sd-jwt' | 'vc+sd-jwt';

  @IsString()
  @IsNotEmpty()
  vct: string;

// AFTER:
class CredentialRequestDto implements CredentialRequest {
  @IsString()
  @IsNotEmpty()
  format: 'dc+sd-jwt' | 'vc+sd-jwt' | 'mso_mdoc';

  @IsString()
  @IsOptional()
  vct?: string;

  @IsString()
  @IsOptional()
  doctype?: string;
```

**Step 2: Update format validation in the controller**

```typescript
// BEFORE:
if (body.format !== 'dc+sd-jwt' && body.format !== 'vc+sd-jwt') {
  throw new BadRequestException({
    error: 'unsupported_credential_format',
    error_description: `Format '${body.format}' is not supported`,
  });
}

// AFTER:
if (body.format !== 'dc+sd-jwt' && body.format !== 'vc+sd-jwt' && body.format !== 'mso_mdoc') {
  throw new BadRequestException({
    error: 'unsupported_credential_format',
    error_description: `Format '${body.format}' is not supported`,
  });
}
```

**Step 3: Run tests**

```bash
cd /c/dev/eguwallet-dgep && npm test -- --testPathPattern=credential
```

**Step 4: Commit**

```bash
cd /c/dev/eguwallet-dgep
git add apps/dgep/src/controllers/credential.controller.ts
git commit -m "fix: accept mso_mdoc format in credential endpoint DTO"
```

### Task 1.3: Export IACA root certificate for verifier trust store

**Context:** The verifier app needs to trust the issuer's signing certificate. Export the IACA/QTSP root cert as a PEM file that will be bundled in the verifier app.

**Files:**
- Create: `/c/dev/eguwallet-dgep/scripts/export-iaca-cert.ts`

**Step 1: Create export script**

```typescript
// scripts/export-iaca-cert.ts
import { PgService } from '@app/database';
import * as fs from 'fs';

async function exportIACACert() {
  const pg = new PgService(/* config */);
  const key = await pg.queryOne(
    `SELECT certificate_pem, qtsp_chain_pem FROM dgep_issuer_keys
     WHERE key_type = 'PID_ISSUER' AND active = true
     ORDER BY created_at DESC LIMIT 1`,
    [],
  );

  if (key?.certificate_pem) {
    fs.writeFileSync('iaca_leaf_cert.pem', key.certificate_pem);
    console.log('Exported leaf certificate to iaca_leaf_cert.pem');
  }
  if (key?.qtsp_chain_pem) {
    const chain = JSON.parse(key.qtsp_chain_pem);
    const rootCert = chain[chain.length - 1]; // Last cert is root
    fs.writeFileSync('iaca_root_cert.pem', rootCert);
    console.log('Exported root certificate to iaca_root_cert.pem');
  }
}
```

Alternatively, just SSH to egucluster3 and query the DB directly:

```bash
ssh eguilde@egucluster3.eguilde.cloud
psql -U postgres eguwallet_dgp -c "SELECT certificate_pem, qtsp_chain_pem FROM dgep_issuer_keys WHERE key_type='PID_ISSUER' ORDER BY created_at DESC LIMIT 1"
```

Save the root cert PEM for use in the verifier app (Task 3.2).

**Step 2: Commit**

```bash
cd /c/dev/eguwallet-dgep && git add scripts/export-iaca-cert.ts && git commit -m "feat: add IACA cert export script for verifier trust store"
```

---

## Workstream 2: Holder Wallet — Proximity Presentation

### Task 2.1: Add EUDI data-transfer library dependency

**Files:**
- Modify: `/c/dev/eguwallet-android/app/build.gradle.kts`
- Modify: `/c/dev/eguwallet-android/settings.gradle.kts` (if repo config is there)

**Step 1: Add Maven repository for EUDI libs**

In the repositories block (root `build.gradle.kts` or `settings.gradle.kts`):

```kotlin
maven {
    url = uri("https://central.sonatype.com/repository/maven-snapshots/")
    mavenContent { snapshotsOnly() }
}
```

**Step 2: Add dependency in `app/build.gradle.kts`**

```kotlin
// ISO 18013-5 proximity presentation (EUDI reference library)
implementation("eu.europa.ec.eudi:eudi-lib-android-iso18013-data-transfer:0.11.0")
```

**Step 3: Sync and verify build**

```bash
cd /c/dev/eguwallet-android && ./gradlew app:assembleDebug
```

If there are dependency conflicts (e.g., CBOR versions), add resolution strategy. The app already uses `com.upokecenter:cbor:4.5.4` and `co.nstant.in:cbor:0.9` — the EUDI library brings `multipaz` which may conflict. Resolve by forcing the EUDI library's versions.

**Step 4: Commit**

```bash
cd /c/dev/eguwallet-android
git add app/build.gradle.kts settings.gradle.kts
git commit -m "feat: add EUDI iso18013-data-transfer library for proximity"
```

### Task 2.2: Delete old BLE/NFC stub implementations

**Context:** Remove the non-functional stubs that will be replaced by the EUDI library. Search for any references to these classes first and update imports.

**Files:**
- Delete: `app/src/main/java/com/eguwallet/wallet/data/transfer/BleTransferService.kt`
- Delete: `app/src/main/java/com/eguwallet/wallet/data/transfer/NfcTransferService.kt`
- Delete: `app/src/main/java/com/eguwallet/wallet/data/transfer/DataTransferManager.kt`
- Delete: `app/src/main/java/com/eguwallet/wallet/domain/protocols/proximity/BlePresentationManager.kt`
- Delete: `app/src/main/java/com/eguwallet/wallet/domain/protocols/proximity/NfcPresentationManager.kt`
- Keep: `app/src/main/java/com/eguwallet/wallet/data/transfer/PresentationMethod.kt`

**Step 1: Find references to deleted classes**

```bash
cd /c/dev/eguwallet-android
grep -rn "BleTransferService\|NfcTransferService\|DataTransferManager\|BlePresentationManager\|NfcPresentationManager" app/src/main/java/ --include="*.kt"
```

Update any DI modules, screens, or viewmodels that reference these classes. Comment out or remove the references — they'll be replaced in subsequent tasks.

**Step 2: Delete the files**

```bash
rm app/src/main/java/com/eguwallet/wallet/data/transfer/BleTransferService.kt
rm app/src/main/java/com/eguwallet/wallet/data/transfer/NfcTransferService.kt
rm app/src/main/java/com/eguwallet/wallet/data/transfer/DataTransferManager.kt
rm app/src/main/java/com/eguwallet/wallet/domain/protocols/proximity/BlePresentationManager.kt
rm app/src/main/java/com/eguwallet/wallet/domain/protocols/proximity/NfcPresentationManager.kt
```

**Step 3: Verify build still compiles (may have broken references)**

```bash
./gradlew app:assembleDebug
```

Fix any compilation errors from removed references.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: remove non-functional BLE/NFC stub implementations"
```

### Task 2.3: Create EudiDocumentManagerBridge

**Context:** The EUDI data-transfer library requires a `DocumentManager` (from `eudi-lib-android-wallet-document-manager`) to access stored credentials. We need to bridge our existing `DocumentManager` + `UnifiedCredentialManager` to the EUDI interface. This is the critical integration point.

**Files:**
- Create: `app/src/main/java/com/eguwallet/wallet/domain/proximity/EudiDocumentManagerBridge.kt`

**Step 1: Implement the bridge**

This class needs to implement the EUDI `DocumentManager` interface (from the document-manager library, which is a transitive dependency of the data-transfer library). It maps our `StoredDocument` / `Credential` objects to the EUDI `Document` / `IssuedDocument` format.

Key methods to implement:
- `getDocuments()` — return all stored mdoc credentials
- `getDocumentById(id)` — return specific document
- `createDocument(format, settings, metadata)` — delegate to our storage
- `storeIssuedDocument(unsigned, data)` — delegate to our storage

The exact EUDI `DocumentManager` interface may require adapting. Study the interface from the library's source at build time.

```kotlin
@Singleton
class EudiDocumentManagerBridge @Inject constructor(
    private val documentManager: DocumentManager,
    private val unifiedCredentialManager: UnifiedCredentialManager,
    private val credentialRepository: CredentialRepository
) {
    // Bridge methods mapping our storage to EUDI expectations
    // This will be refined after analyzing the exact EUDI DocumentManager interface
    // from the compiled dependency
}
```

**Step 2: Verify build**

```bash
./gradlew app:assembleDebug
```

**Step 3: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/domain/proximity/EudiDocumentManagerBridge.kt
git commit -m "feat: add EUDI DocumentManager bridge to existing credential storage"
```

### Task 2.4: Create ProximityPresentationManager

**Context:** This is the main proximity presentation orchestrator. It wraps the EUDI `TransferManager`, configures BLE peripheral mode, and exposes transfer events as Kotlin Flows for the ViewModel.

**Files:**
- Create: `app/src/main/java/com/eguwallet/wallet/domain/proximity/ProximityPresentationManager.kt`

**Step 1: Implement the manager**

```kotlin
package com.eguwallet.wallet.domain.proximity

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import eu.europa.ec.eudi.iso18013.transfer.*
import kotlinx.coroutines.flow.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ProximityPresentationManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val documentManagerBridge: EudiDocumentManagerBridge
) {
    private val _events = MutableSharedFlow<TransferEvent>(replay = 1)
    val events: SharedFlow<TransferEvent> = _events.asSharedFlow()

    private var transferManager: TransferManager? = null

    fun initialize() {
        transferManager = TransferManager.getDefault(
            context = context,
            documentManager = documentManagerBridge.eudiDocumentManager,
            retrievalMethods = listOf(
                BleRetrievalMethod(
                    peripheralServerMode = true,
                    centralClientMode = false,
                    clearBleCache = true
                )
            )
        )

        transferManager?.addTransferEventListener { event ->
            _events.tryEmit(event)
        }
    }

    fun startQrEngagement() {
        transferManager?.startQrEngagement()
    }

    fun sendResponse(disclosedDocuments: DisclosedDocuments) {
        // Get the current request to generate response
        // This will be called after user consent
    }

    fun disconnect() {
        transferManager?.close()
        transferManager = null
    }
}
```

The exact API depends on the EUDI library version. Adjust after dependency resolution in Task 2.1.

**Step 2: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/domain/proximity/ProximityPresentationManager.kt
git commit -m "feat: add ProximityPresentationManager wrapping EUDI TransferManager"
```

### Task 2.5: Create NFC Engagement Service

**Context:** For NFC tap engagement, Android requires an HCE (Host Card Emulation) service. The EUDI library provides `NfcEngagementService` as an abstract class — we extend it and register in the manifest.

**Files:**
- Create: `app/src/main/java/com/eguwallet/wallet/services/WalletNfcEngagementService.kt`
- Create: `app/src/main/res/xml/nfc_engagement_apdu_service.xml`
- Modify: `app/src/main/AndroidManifest.xml`

**Step 1: Create the service**

```kotlin
package com.eguwallet.wallet.services

import eu.europa.ec.eudi.iso18013.transfer.TransferManager
import eu.europa.ec.eudi.iso18013.transfer.engagement.NfcEngagementService

class WalletNfcEngagementService : NfcEngagementService() {
    override val transferManager: TransferManager
        get() = // Get from application-level singleton or Hilt
            (application as com.eguwallet.wallet.WalletApplication)
                .proximityPresentationManager
                .getTransferManager()
}
```

**Step 2: Create APDU service XML**

```xml
<!-- app/src/main/res/xml/nfc_engagement_apdu_service.xml -->
<host-apdu-service xmlns:android="http://schemas.android.com/apk/res/android"
    android:description="@string/nfc_engagement_service_desc"
    android:requireDeviceUnlock="true">
    <aid-group android:category="other"
        android:description="@string/nfc_engagement_aid_group">
        <aid-filter android:name="A0000002480400" />
    </aid-group>
</host-apdu-service>
```

**Step 3: Register in AndroidManifest.xml**

Add inside `<application>`:

```xml
<service
    android:name=".services.WalletNfcEngagementService"
    android:exported="true"
    android:permission="android.permission.BIND_NFC_SERVICE">
    <intent-filter>
        <action android:name="android.nfc.action.NDEF_DISCOVERED" />
        <action android:name="android.nfc.cardemulation.action.HOST_APDU_SERVICE" />
    </intent-filter>
    <meta-data
        android:name="android.nfc.cardemulation.host_apdu_service"
        android:resource="@xml/nfc_engagement_apdu_service" />
</service>
```

**Step 4: Add string resources**

```xml
<string name="nfc_engagement_service_desc">EguWallet NFC Credential Presentation</string>
<string name="nfc_engagement_aid_group">ISO 18013-5 mDL Application</string>
```

**Step 5: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/services/WalletNfcEngagementService.kt \
       app/src/main/res/xml/nfc_engagement_apdu_service.xml \
       app/src/main/AndroidManifest.xml \
       app/src/main/res/values/strings.xml
git commit -m "feat: add NFC HCE engagement service for ISO 18013-5 proximity"
```

### Task 2.6: Create Proximity Presentation UI (Screen + ViewModel)

**Context:** The presentation screen shows: QR code → consent UI → success. Uses PrimeNG-like Material 3 components. The ViewModel manages the `TransferManager` lifecycle and maps events to UI states.

**Files:**
- Create: `app/src/main/java/com/eguwallet/wallet/viewmodels/ProximityPresentationViewModel.kt`
- Create: `app/src/main/java/com/eguwallet/wallet/ui/screens/ProximityPresentationScreen.kt`

**Step 1: Create ViewModel**

```kotlin
package com.eguwallet.wallet.viewmodels

@HiltViewModel
class ProximityPresentationViewModel @Inject constructor(
    private val proximityManager: ProximityPresentationManager,
    private val authenticationManager: AuthenticationManager
) : ViewModel() {

    sealed class UiState {
        data object Idle : UiState()
        data class ShowingQR(val qrCode: String) : UiState()
        data object Connecting : UiState()
        data class RequestReceived(
            val requestedAttributes: List<RequestedAttribute>,
            val verifierName: String?
        ) : UiState()
        data object Sending : UiState()
        data object Success : UiState()
        data class Error(val message: String) : UiState()
    }

    data class RequestedAttribute(
        val namespace: String,
        val elementId: String,
        val displayName: String,
        var selected: Boolean = true
    )

    private val _uiState = MutableStateFlow<UiState>(UiState.Idle)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    fun startPresentation() {
        proximityManager.initialize()
        viewModelScope.launch {
            proximityManager.events.collect { event ->
                handleTransferEvent(event)
            }
        }
        proximityManager.startQrEngagement()
    }

    private fun handleTransferEvent(event: TransferEvent) {
        when (event) {
            is TransferEvent.QrEngagementReady -> {
                _uiState.value = UiState.ShowingQR(event.qrCode.content)
            }
            is TransferEvent.Connecting -> {
                _uiState.value = UiState.Connecting
            }
            is TransferEvent.Connected -> { /* wait for request */ }
            is TransferEvent.RequestReceived -> {
                val attrs = mapRequestedAttributes(event.processedRequest)
                _uiState.value = UiState.RequestReceived(attrs, null)
            }
            is TransferEvent.ResponseSent -> {
                _uiState.value = UiState.Success
            }
            is TransferEvent.Disconnected -> {
                if (_uiState.value !is UiState.Success) {
                    _uiState.value = UiState.Idle
                }
            }
            is TransferEvent.Error -> {
                _uiState.value = UiState.Error(event.error.message ?: "Unknown error")
            }
            else -> {}
        }
    }

    fun approveAndSend(selectedAttributes: List<RequestedAttribute>) {
        _uiState.value = UiState.Sending
        // Build DisclosedDocuments from selected attributes
        // Call proximityManager.sendResponse()
    }

    override fun onCleared() {
        proximityManager.disconnect()
        super.onCleared()
    }
}
```

**Step 2: Create Compose screen**

Build a screen with 4 states:
1. **QR display** — Large QR code + "Or tap your phone for NFC" text
2. **Connecting** — Spinner with "Connecting..."
3. **Consent** — List of requested attributes with toggles + "Share" button
4. **Success** — Checkmark icon + "Credentials shared successfully"

Use Material 3 components, Tailwind-inspired spacing. Follow the wallet app's existing theme.

**Step 3: Add navigation**

Add the new screen to the navigation graph and add a "Present in person" button on the home screen.

**Step 4: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/viewmodels/ProximityPresentationViewModel.kt \
       app/src/main/java/com/eguwallet/wallet/ui/screens/ProximityPresentationScreen.kt
git commit -m "feat: add proximity presentation screen with QR, consent, and success states"
```

### Task 2.7: Add dual-format credential issuance (SD-JWT + mdoc)

**Context:** Currently `OpenID4VCIManager.requestCredential()` and `IssuerCredentialRequestViewModel.requestCredential()` only request `dc+sd-jwt` or `mso_mdoc` — not both. For proximity presentation to work, the wallet needs an mdoc version of the PID. The simplest approach: make two sequential credential requests after token exchange.

**Files:**
- Modify: `app/src/main/java/com/eguwallet/wallet/ui/viewmodels/IssuerCredentialRequestViewModel.kt`
- Modify: `app/src/main/java/com/eguwallet/wallet/domain/protocols/openid/OpenID4VCIManager.kt`

**Step 1: After successful SD-JWT issuance, make a second request for mdoc**

In `IssuerCredentialRequestViewModel.acceptCredentialOffer()`, after the SD-JWT credential is stored, make a second credential request with `format: "mso_mdoc"` and `doctype: "eu.europa.ec.eudi.pid.1"` using the same access token (request a fresh c_nonce if needed).

```kotlin
// After storing SD-JWT credential...
// Request mdoc version with same access token
try {
    val mdocResponse = requestCredential(
        accessToken = tokenResponse.access_token,
        format = "mso_mdoc",
        doctype = "eu.europa.ec.eudi.pid.1",
        cNonce = sdJwtResponse.c_nonce ?: tokenResponse.c_nonce
    )
    // Store mdoc credential via MdocCredentialManager
    mdocCredentialManager.storeMdocCredential(mdocResponse)
    Log.i(TAG, "mdoc PID credential stored for proximity presentation")
} catch (e: Exception) {
    Log.w(TAG, "mdoc issuance failed (SD-JWT still valid): ${e.message}")
    // Non-fatal — SD-JWT is sufficient for remote presentation
}
```

**Step 2: Verify the mdoc is stored alongside the SD-JWT**

The `MdocCredentialManager.storeMdocCredential()` already handles parsing and storage. Verify it stores with a distinct ID so both credentials coexist.

**Step 3: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/ui/viewmodels/IssuerCredentialRequestViewModel.kt
git commit -m "feat: request mdoc format alongside SD-JWT during PID issuance"
```

### Task 2.8: Update Hilt DI modules

**Files:**
- Modify: `app/src/main/java/com/eguwallet/wallet/di/DomainModule.kt`

**Step 1: Provide ProximityPresentationManager and EudiDocumentManagerBridge**

```kotlin
@Provides
@Singleton
fun provideEudiDocumentManagerBridge(
    documentManager: DocumentManager,
    unifiedCredentialManager: UnifiedCredentialManager,
    credentialRepository: CredentialRepository
): EudiDocumentManagerBridge {
    return EudiDocumentManagerBridge(documentManager, unifiedCredentialManager, credentialRepository)
}

@Provides
@Singleton
fun provideProximityPresentationManager(
    @ApplicationContext context: Context,
    bridge: EudiDocumentManagerBridge
): ProximityPresentationManager {
    return ProximityPresentationManager(context, bridge)
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/di/DomainModule.kt
git commit -m "feat: register proximity presentation dependencies in Hilt"
```

### Task 2.9: Update ARF compliance checks

**Files:**
- Modify: `app/src/main/java/com/eguwallet/wallet/compliance/ARFComplianceManager.kt`

**Step 1: Update hardcoded false checks**

Find `checkISO18013Support()` and `checkMdocSupport()` — change from `return false` to `return true`.

Also update `checkCrossBorderSupport()` if proximity enables it.

**Step 2: Commit**

```bash
git add app/src/main/java/com/eguwallet/wallet/compliance/ARFComplianceManager.kt
git commit -m "fix: update ARF compliance checks for ISO 18013-5 proximity support"
```

### Task 2.10: Build and push

**Step 1: Full build**

```bash
cd /c/dev/eguwallet-android && ./gradlew app:assembleDebug
```

**Step 2: Push to GitHub**

```bash
git push origin main
```

---

## Workstream 3: Verifier App (New Project)

### Task 3.1: Create Android project

**Context:** Create a new Android project at `/c/dev/eguwallet-android-verifier` with the same tech stack as the wallet app.

**Step 1: Create project using Android Studio template or manually**

The fastest approach: copy the wallet project's build infrastructure and strip down to essentials.

Create the following project structure:

```
/c/dev/eguwallet-android-verifier/
├── app/
│   ├── build.gradle.kts
│   └── src/main/
│       ├── AndroidManifest.xml
│       ├── java/com/eguwallet/verifier/
│       │   ├── VerifierApplication.kt
│       │   └── MainActivity.kt
│       └── res/
│           ├── values/
│           │   ├── strings.xml
│           │   ├── colors.xml
│           │   └── themes.xml
│           └── drawable/
├── build.gradle.kts              (root)
├── settings.gradle.kts
├── gradle.properties
├── gradle/
│   └── libs.versions.toml
└── .gitignore
```

**Key build.gradle.kts (app level):**

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.hilt.android)
    alias(libs.plugins.ksp)
}

android {
    namespace = "com.eguwallet.verifier"
    compileSdk = 35
    defaultConfig {
        applicationId = "verifier.eguwallet.com"
        minSdk = 30
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures { compose = true }
}

dependencies {
    // EUDI verifier core
    implementation("eu.europa.ec.eudi:eudi-lib-android-verifier-core:0.1.0")

    // Compose
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
    implementation("androidx.navigation:navigation-compose:2.8.5")

    // Hilt
    implementation("com.google.dagger:hilt-android:2.56")
    ksp("com.google.dagger:hilt-compiler:2.56")
    implementation("androidx.hilt:hilt-navigation-compose:1.2.0")

    // QR scanning
    implementation("com.google.mlkit:barcode-scanning:17.3.0")
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("androidx.camera:camera-view:1.4.1")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
```

**Step 2: Initialize git repo**

```bash
cd /c/dev/eguwallet-android-verifier
git init
git add -A
git commit -m "feat: initial verifier app project setup"
```

### Task 3.2: Add trust anchor certificates

**Files:**
- Create: `app/src/main/res/raw/iaca_root_cert.pem`
- Create: `app/src/main/java/com/eguwallet/verifier/domain/TrustAnchorProvider.kt`

**Step 1: Copy the IACA cert from Task 1.3 output**

Place the PEM file in `app/src/main/res/raw/iaca_root_cert.pem`.

**Step 2: Create TrustAnchorProvider**

```kotlin
package com.eguwallet.verifier.domain

import android.content.Context
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.InputStream
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class TrustAnchorProvider @Inject constructor(
    @ApplicationContext private val context: Context
) {
    fun getTrustedCertificates(): List<X509Certificate> {
        val factory = CertificateFactory.getInstance("X.509")
        val certs = mutableListOf<X509Certificate>()

        val certResources = listOf(R.raw.iaca_root_cert)
        for (resId in certResources) {
            context.resources.openRawResource(resId).use { stream ->
                val cert = factory.generateCertificate(stream) as X509Certificate
                certs.add(cert)
            }
        }
        return certs
    }
}
```

**Step 3: Commit**

```bash
git add app/src/main/res/raw/ app/src/main/java/com/eguwallet/verifier/domain/TrustAnchorProvider.kt
git commit -m "feat: add IACA trust anchor certificates and provider"
```

### Task 3.3: Create RequestTemplates

**Files:**
- Create: `app/src/main/java/com/eguwallet/verifier/domain/RequestTemplates.kt`

**Step 1: Define request templates**

As specified in the design document — templates for Full PID, Age Only, mDL, Romanian ID, and custom requests.

**Step 2: Commit**

```bash
git add app/src/main/java/com/eguwallet/verifier/domain/RequestTemplates.kt
git commit -m "feat: add verification request templates (PID, mDL, age-only)"
```

### Task 3.4: Create VerificationManager

**Context:** Wraps `EudiVerifier` and `TransferManager`. Manages the complete verification flow: QR scan → BLE connect → send request → receive and validate response.

**Files:**
- Create: `app/src/main/java/com/eguwallet/verifier/domain/VerificationManager.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/domain/VerificationResult.kt`

**Step 1: Implement VerificationManager**

```kotlin
package com.eguwallet.verifier.domain

@Singleton
class VerificationManager @Inject constructor(
    @ApplicationContext private val context: Context,
    private val trustAnchorProvider: TrustAnchorProvider
) {
    private val _events = MutableSharedFlow<VerifierEvent>(replay = 1)
    val events: SharedFlow<VerifierEvent> = _events.asSharedFlow()

    private var verifier: EudiVerifier? = null
    private var transferManager: TransferManager? = null

    fun initialize() {
        verifier = EudiVerifier(context, EudiVerifierConfig {
            configureLogging(level = Logger.LEVEL_DEBUG)
        }) {
            trustedCertificates(trustAnchorProvider.getTrustedCertificates())
        }
    }

    fun startVerification(docRequest: DocRequest, qrCodeText: String) {
        val tm = verifier!!.createTransferManager {
            addEngagementMethod(
                TransferConfig.EngagementMethod.QR,
                listOf(MdocConnectionMethodBle(
                    supportsPeripheralServerMode = false,
                    supportsCentralClientMode = true,
                    peripheralServerModeUuid = null,
                    centralClientModeUuid = UUID.randomUUID()
                ))
            )
        }
        transferManager = tm

        tm.addListener { event ->
            when (event) {
                is TransferEvent.Connected -> {
                    tm.sendRequest(DeviceRequest(listOf(docRequest)))
                }
                is TransferEvent.ResponseReceived -> {
                    val result = processResponse(event.response)
                    _events.tryEmit(VerifierEvent.ResultReady(result))
                }
                is TransferEvent.Error -> {
                    _events.tryEmit(VerifierEvent.Failed(event.error.message ?: "Unknown"))
                }
                else -> {}
            }
        }

        tm.startQRDeviceEngagement(qrCodeText)
    }

    private fun processResponse(response: DeviceResponse): VerificationResult {
        // Extract claims and validity from the EUDI library's response
        // Map to our VerificationResult model
    }

    fun disconnect() {
        transferManager?.close()
    }
}
```

**Step 2: Define VerificationResult model**

```kotlin
data class VerificationResult(
    val verified: Boolean,
    val attributes: List<VerifiedAttribute>,
    val issuerTrusted: Boolean,
    val deviceAuthValid: Boolean,
    val dataIntegrity: Boolean,
    val validFrom: String?,
    val validUntil: String?,
    val warnings: List<String>
)

data class VerifiedAttribute(
    val namespace: String,
    val elementId: String,
    val displayName: String,
    val value: Any?,
    val digestValid: Boolean
)
```

**Step 3: Commit**

```bash
git add app/src/main/java/com/eguwallet/verifier/domain/
git commit -m "feat: add VerificationManager with EUDI verifier-core integration"
```

### Task 3.5: Create Verifier UI screens

**Files:**
- Create: `app/src/main/java/com/eguwallet/verifier/ui/screens/HomeScreen.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/ui/screens/SelectRequestScreen.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/ui/screens/ScanScreen.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/ui/screens/WaitingScreen.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/ui/screens/ResultScreen.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/viewmodels/VerificationViewModel.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/navigation/NavigationGraph.kt`

**Step 1: Create VerificationViewModel**

Manages the flow: Idle → SelectRequest → Scanning → Waiting → Result/Error

```kotlin
@HiltViewModel
class VerificationViewModel @Inject constructor(
    private val verificationManager: VerificationManager
) : ViewModel() {
    sealed class UiState {
        data object Home : UiState()
        data object SelectRequest : UiState()
        data object Scanning : UiState()
        data object Waiting : UiState()
        data class Result(val result: VerificationResult) : UiState()
        data class Error(val message: String) : UiState()
    }

    private val _uiState = MutableStateFlow<UiState>(UiState.Home)
    val uiState: StateFlow<UiState> = _uiState.asStateFlow()

    var selectedRequest: DocRequest? = null

    fun selectRequest(request: DocRequest) { ... }
    fun onQrScanned(qrText: String) { ... }
    fun reset() { ... }
}
```

**Step 2: Create each screen**

- **HomeScreen**: Big "Verify Identity" button, Material 3 card layout
- **SelectRequestScreen**: List of request templates as clickable cards
- **ScanScreen**: CameraX preview with ML Kit barcode scanner overlay
- **WaitingScreen**: Circular progress indicator + "Waiting for holder..."
- **ResultScreen**: Green/red indicators per attribute, trust badge, validity dates

**Step 3: Create NavigationGraph**

```kotlin
@Composable
fun VerifierNavGraph(navController: NavHostController) {
    NavHost(navController, startDestination = "home") {
        composable("home") { HomeScreen(navController) }
        composable("select") { SelectRequestScreen(navController) }
        composable("scan") { ScanScreen(navController) }
        composable("waiting") { WaitingScreen(navController) }
        composable("result") { ResultScreen(navController) }
    }
}
```

**Step 4: Commit**

```bash
git add app/src/main/java/com/eguwallet/verifier/
git commit -m "feat: add verifier UI screens (home, scan, waiting, result)"
```

### Task 3.6: Add Hilt DI module and Application class

**Files:**
- Create: `app/src/main/java/com/eguwallet/verifier/di/AppModule.kt`
- Create: `app/src/main/java/com/eguwallet/verifier/VerifierApplication.kt`
- Modify: `app/src/main/java/com/eguwallet/verifier/MainActivity.kt`

**Step 1: Create AppModule**

```kotlin
@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideTrustAnchorProvider(@ApplicationContext context: Context) =
        TrustAnchorProvider(context)

    @Provides
    @Singleton
    fun provideVerificationManager(
        @ApplicationContext context: Context,
        trustProvider: TrustAnchorProvider
    ) = VerificationManager(context, trustProvider)
}
```

**Step 2: Commit**

```bash
git add app/src/main/java/com/eguwallet/verifier/
git commit -m "feat: add Hilt DI and Application class for verifier"
```

### Task 3.7: Build, test, and create GitHub repo

**Step 1: Build**

```bash
cd /c/dev/eguwallet-android-verifier && ./gradlew app:assembleDebug
```

**Step 2: Create GitHub repo**

```bash
gh repo create eguilde/eguwallet-android-verifier --private --source=. --push
```

**Step 3: Push**

```bash
git push -u origin main
```

---

## Workstream 4: Integration Testing

### Task 4.1: End-to-end test — mdoc issuance

1. Deploy updated eguwallet-dgep to egucluster3
2. Request PID via the wallet app with dual-format issuance
3. Verify both SD-JWT and mdoc credentials are stored in the wallet
4. Check mdoc MSO has correct deviceKeyInfo (holder's key, not issuer's)

### Task 4.2: End-to-end test — BLE proximity presentation

1. Install wallet app on Device A (holder)
2. Install verifier app on Device B (verifier)
3. On Device A: tap "Present in person" → shows QR code
4. On Device B: tap "Verify Identity" → select "Full PID" → scan QR
5. On Device A: consent screen shows requested attributes → approve
6. On Device B: result screen shows verified attributes with green indicators
7. Verify all validation passes (issuer sig, device sig, data integrity)

### Task 4.3: End-to-end test — NFC engagement

1. Same devices as above
2. On Device A: tap "Present in person" → enable NFC
3. Tap Device B's NFC against Device A
4. BLE connection established automatically
5. Same flow continues from consent → verification

---

## Implementation Order Summary

| # | Task | Repo | Est. Effort |
|---|------|------|-------------|
| 1.1 | Fix mdoc device key binding | eguwallet-dgep | 1-2 hours |
| 1.2 | Fix credential controller DTO | eguwallet-dgep | 30 min |
| 1.3 | Export IACA cert | eguwallet-dgep | 30 min |
| 2.1 | Add EUDI library dependency | eguwallet-android | 1-2 hours (dep conflicts) |
| 2.2 | Delete old stubs | eguwallet-android | 1 hour |
| 2.3 | Create DocumentManager bridge | eguwallet-android | 2-3 hours |
| 2.4 | Create ProximityPresentationManager | eguwallet-android | 2-3 hours |
| 2.5 | Create NFC engagement service | eguwallet-android | 1 hour |
| 2.6 | Create proximity UI | eguwallet-android | 3-4 hours |
| 2.7 | Dual-format issuance | eguwallet-android | 2-3 hours |
| 2.8 | Hilt DI updates | eguwallet-android | 30 min |
| 2.9 | ARF compliance updates | eguwallet-android | 30 min |
| 2.10 | Build and push | eguwallet-android | 30 min |
| 3.1 | Create verifier project | eguwallet-android-verifier | 2-3 hours |
| 3.2 | Trust anchors | eguwallet-android-verifier | 1 hour |
| 3.3 | Request templates | eguwallet-android-verifier | 30 min |
| 3.4 | VerificationManager | eguwallet-android-verifier | 2-3 hours |
| 3.5 | Verifier UI screens | eguwallet-android-verifier | 4-5 hours |
| 3.6 | Hilt DI | eguwallet-android-verifier | 30 min |
| 3.7 | Build and push | eguwallet-android-verifier | 1 hour |
| 4.x | Integration testing | All | 2-3 hours |

**Total estimated: ~30-35 hours**

**Critical path:** 1.1 → 1.2 → 2.1 → 2.3 → 2.4 → 2.7 → 4.2

Workstream 3 (verifier app) can be built in parallel with Workstream 2 after Task 1.3.
