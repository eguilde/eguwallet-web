# EguWallet Video Production Plan
**Date:** 2026-02-26
**Status:** Deferred — Android app not yet production-ready

## Overview

8 narrated demo videos showing EguWallet in action, in Romanian, with realistic mock data (no real PII).

## Prerequisites (blocking)

- [ ] Android app production-ready (documents render correctly, onboarding flow stable)
- [ ] Mock credential set issued on test environment (see below)
- [ ] Romanian mock personas created (see below)

## Mock Personas (safe for recording — no real PII)

```
Persoana 1 (cetățean):
  Nume: Ion Popescu
  CNP: 1850215123456 (valid Luhn, fictive)
  Adresă: Str. Florilor nr. 12, Voluntari, Ilfov
  Telefon: 07XX XXX XXX (blurred)

Persoana 2 (minor, elev):
  Nume: Maria Ionescu
  CNP: 5100310123456 (minor, fictive)
  Școală: Liceul Teoretic "Ion Barbu" Voluntari

Persoana 3 (reprezentant firmă):
  Nume: Alexandru Gheorghe
  CUI: RO12345678
  Firmă: Alpha Digital SRL
```

## Romanian ID Card & Passport Simulation

Since real documents cannot appear on video, use one of these approaches:

### Option A: Leonardo.ai photorealistic mock cards (recommended)
- Generate a realistic Romanian buletin design using Leonardo with fictive data
- Use as prop in filming — no real biometric data
- Prompt example: "Photorealistic Romanian identity card (buletin), white and blue design, EU flag, ROU text, male photo placeholder, name ION POPESCU, CNP 185..., expiry 2030, realistic card texture"

### Option B: Android mockup screen
- Show only the digital credential screen (already designed in app UI)
- Never show the physical document

### Option C: Blurred/pixelated real card
- Film with real card but apply Gaussian blur on all personal data fields in post-production
- Safe for publication

## NFC Scanning Simulation

For the enrollment video (scanning physical ID to extract data):
- **Real NFC read**: Use actual Romanian eCI (electronic chip ID) on Android emulator via USB-attached NFC reader, or real device
- **Simulated NFC**: Show phone approaching card, then cut to credential appearing in wallet (already-issued mock credential)
- The NFC read animation is already in the app UI — can be triggered without a real card using a test NFC tag with mock PACE data

## Video Scripts (8 videos)

### V1: Enrollment (2:30)
**Scene:** Kitchen table, man scans ID card via NFC
**Narration:** Romanian voice, script at `docs/scripts/v1-enrollment-ro.md`
**Key moments:** NFC tap → face scan → PID credential appears in wallet

### V2: DGEP Inspector (1:45)
**Scene:** Office, inspector with tablet, citizen shows wallet QR
**Narration:** Romanian voice, script at `docs/scripts/v2-dgep-inspector-ro.md`
**Key moments:** Inspector opens verifier app → QR displayed → citizen approves → inspector sees verified identity

### V3: Retail Age 18+ (0:45)
**Scene:** Supermarket checkout, alcohol purchase
**Narration:** Romanian voice
**Key moments:** Cashier shows QR → customer approves minimal disclosure → only "18+: DA" transmitted → no name shown

### V4: Police Traffic Stop (2:00)
**Scene:** Roadside, police officer with phone
**Narration:** Romanian voice
**Key moments:** Officer opens verifier → POLICE_VEHICLE_PACKAGE QR → citizen approves all 5 docs → officer sees ID + DL + registration + RCA + ITP in one screen

### V5: Company Registration Check (1:30)
**Scene:** Modern office, B2B meeting
**Narration:** Romanian voice
**Key moments:** Partner verifies COMPANY_REGISTRATION + COMPANY_MANDATE simultaneously → legal representative confirmed

### V6: Legal Representative + QES (2:00)
**Scene:** Home office desk
**Narration:** Romanian voice
**Key moments:** CONTRACT_SIGNING_FULL template → identity + mandate + QES certificate verified → document signed with eIDAS LoA High

### V7: QES Document Signing (1:30)
**Scene:** Law firm / notary office
**Narration:** Romanian voice
**Key moments:** Notary requests remote identification → EguWallet PID presented → QES applied to contract → legally binding, no physical presence needed

### V8: Student at School (1:00)
**Scene:** School entrance gate
**Narration:** Romanian voice
**Key moments:** Student taps phone on NFC reader → CARNET_ELEV credential → gate opens → no physical card needed

## Production Setup

### Hardware
- Android phone (Pixel 6+) or Pixel Emulator (API 33+)
- USB-C to 3.5mm adapter for external mic (optional)
- Ring light or natural window light (matches our illustrations)
- Tripod for steady shots

### Software
- **Screen recording**: `adb shell screenrecord --size 1080x1920 /sdcard/recording.mp4`
- **NFC simulation**: NFC Tools Pro app for writing test tags
- **Video editing**: DaVinci Resolve (free) or CapCut
- **Romanian TTS voiceover**: ElevenLabs or Google TTS (Romanian voice `ro-RO-Standard-A`)
- **Post-production**: Apply blur to any accidental PII, add lower-third captions

### Screen Recording Command
```bash
# On connected Android device:
adb shell screenrecord --bit-rate 8000000 --size 1080x1920 /sdcard/eguwallet_v1.mp4
# Press Ctrl+C to stop, then pull:
adb pull /sdcard/eguwallet_v1.mp4 ./recordings/
```

## Leonardo.ai Animations (DONE ✅)

9 motion clips generated and saved to `/public/assets/videos/`:
- usecase-police.mp4 (6.7MB)
- usecase-business.mp4 (4.9MB)
- usecase-education.mp4 (6.1MB)
- usecase-retail.mp4 (3.8MB)
- usecase-banking.mp4 (4.4MB)
- usecase-healthcare.mp4 (4.1MB)
- usecase-legal.mp4 (5.7MB)
- usecase-trust.mp4 (6.0MB)
- usecase-enrollment.mp4 (4.0MB)

These are used as ambient background animations on eguwallet.eu use cases section.

## Website Integration (DONE ✅)

- `eguwallet.eu/ro/#usecases` — animated video backgrounds for all 7 categories
- `eguwallet.eu/ro/#trust` — animated trust section with enrollment video
- Still images serve as poster frames while video loads

## Next Steps (when Android app is ready)

1. Issue mock credentials on test DGEP instance
2. Record V1 (enrollment) first — validates full flow
3. Record remaining 7 videos
4. Record Romanian voiceovers or use ElevenLabs TTS
5. Edit and publish to YouTube / website