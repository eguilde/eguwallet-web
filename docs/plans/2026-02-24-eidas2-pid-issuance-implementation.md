# eIDAS 2.0 PID/Passport Issuance Flow — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement end-to-end eIDAS 2.0 document issuance: Android wizard for document scanning + selfie, WIA-authenticated REST APIs on DGEP/DGP, admin review frontends, and credential offer email flow.

**Architecture:** Android wallet submits document scans + selfie via WIA+DPoP-authenticated REST endpoints on DGEP (ID cards) and DGP (passports). Inspectors review requests in minimal Angular admin UIs, fill citizen data forms, and approve. Approval triggers credential offer email with QR code. Wallet scans QR and completes OpenID4VCI pre-authorized code flow (already implemented).

**Tech Stack:** NestJS 10 (Bun), Angular 21 + PrimeNG + TailwindCSS, Kotlin + Jetpack Compose + ML Kit, PostgreSQL, OpenID4VCI, WIA (RFC draft-ietf-oauth-attestation-based-client-auth), DPoP (RFC 9449)

---

## Task 1: DGEP — Database Migration for document_requests

**Files:**
- Create: `C:/dev/eguwallet-dgep/src/database/schemas/026-document-requests.sql`

**Step 1: Write the migration**

```sql
-- 026-document-requests.sql
-- Document issuance requests submitted from Android wallet app

CREATE TABLE IF NOT EXISTS document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(10) NOT NULL CHECK (document_type IN ('CI', 'ECI')),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  document_scan_front TEXT NOT NULL,
  document_scan_back TEXT,
  selfie_photo TEXT NOT NULL,
  wallet_instance_id VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'credential_offered', 'completed')),

  -- Inspector fills these on approval
  given_name VARCHAR(255),
  family_name VARCHAR(255),
  birth_date DATE,
  cnp VARCHAR(13),
  gender VARCHAR(10),
  nationality VARCHAR(50) DEFAULT 'RO',
  resident_address TEXT,
  resident_city VARCHAR(255),
  resident_postal_code VARCHAR(20),
  resident_country VARCHAR(10) DEFAULT 'RO',
  id_series VARCHAR(10),
  id_number VARCHAR(20),

  -- Review metadata
  inspector_id VARCHAR(255),
  inspector_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  pre_authorization_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_document_requests_status ON document_requests(status);
CREATE INDEX idx_document_requests_email ON document_requests(email);
CREATE INDEX idx_document_requests_created ON document_requests(created_at DESC);
```

**Step 2: Verify migration file exists**

Run: `ls -la /c/dev/eguwallet-dgep/src/database/schemas/026-document-requests.sql`
Expected: file exists

**Step 3: Commit**

```bash
cd /c/dev/eguwallet-dgep
git add src/database/schemas/026-document-requests.sql
git commit -m "feat(dgep): add document_requests table migration"
```

---

## Task 2: DGEP — WIA Authentication Guard

**Files:**
- Create: `C:/dev/eguwallet-dgep/src/services/wia-auth.service.ts`
- Create: `C:/dev/eguwallet-dgep/src/guards/wia-auth.guard.ts`

**Step 1: Write the WIA auth service**

This service verifies Wallet Instance Attestation JWTs and Client-Attestation-PoP JWTs per draft-ietf-oauth-attestation-based-client-auth.

```typescript
// C:/dev/eguwallet-dgep/src/services/wia-auth.service.ts
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import * as jose from 'jose';

interface WiaPayload {
  iss: string;
  sub: string;
  iat: number;
  exp: number;
  cnf: { jwk: jose.JWK };
  aal?: string;
  wallet_instance_id?: string;
}

@Injectable()
export class WiaAuthService {
  private readonly logger = new Logger(WiaAuthService.name);
  private cachedJwks: jose.JSONWebKeySet | null = null;
  private jwksCachedAt = 0;
  private readonly JWKS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
  ) {}

  private get walletProviderUrl(): string {
    return this.configService.get<string>('WALLET_PROVIDER_URL', 'https://wallet.eguwallet.eu');
  }

  async fetchWalletProviderJwks(): Promise<jose.JSONWebKeySet> {
    const now = Date.now();
    if (this.cachedJwks && now - this.jwksCachedAt < this.JWKS_CACHE_TTL) {
      return this.cachedJwks;
    }

    const jwksUrl = `${this.walletProviderUrl}/.well-known/jwks`;
    this.logger.log(`Fetching wallet provider JWKS from ${jwksUrl}`);

    try {
      const response = await this.httpService.axiosRef.get(jwksUrl, { timeout: 10000 });
      this.cachedJwks = response.data;
      this.jwksCachedAt = now;
      return this.cachedJwks;
    } catch (error) {
      this.logger.error(`Failed to fetch JWKS: ${error.message}`);
      if (this.cachedJwks) {
        this.logger.warn('Using stale cached JWKS');
        return this.cachedJwks;
      }
      throw new UnauthorizedException('Cannot verify wallet attestation: JWKS unavailable');
    }
  }

  async verifyWia(wiaJwt: string): Promise<WiaPayload> {
    const jwks = await this.fetchWalletProviderJwks();
    const keySet = jose.createLocalJWKSet(jwks);

    try {
      const { payload } = await jose.jwtVerify(wiaJwt, keySet, {
        issuer: this.walletProviderUrl,
        clockTolerance: 30,
      });

      if (!payload.cnf || !(payload.cnf as any).jwk) {
        throw new UnauthorizedException('WIA missing cnf.jwk claim');
      }

      return payload as unknown as WiaPayload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.error(`WIA verification failed: ${error.message}`);
      throw new UnauthorizedException(`Invalid wallet instance attestation: ${error.message}`);
    }
  }

  async verifyClientAttestationPoP(popJwt: string, holderJwk: jose.JWK, audience: string): Promise<void> {
    const publicKey = await jose.importJWK(holderJwk, 'ES256');

    try {
      await jose.jwtVerify(popJwt, publicKey, {
        audience,
        clockTolerance: 10,
        maxTokenAge: '5m',
      });
    } catch (error) {
      this.logger.error(`Client-Attestation-PoP verification failed: ${error.message}`);
      throw new UnauthorizedException(`Invalid client attestation PoP: ${error.message}`);
    }
  }

  async authenticate(headers: Record<string, string>, requestUrl: string): Promise<WiaPayload> {
    const wiaJwt = headers['client-attestation'];
    const popJwt = headers['client-attestation-pop'];

    if (!wiaJwt) {
      throw new UnauthorizedException('Missing Client-Attestation header');
    }
    if (!popJwt) {
      throw new UnauthorizedException('Missing Client-Attestation-PoP header');
    }

    // 1. Verify WIA against wallet-provider JWKS
    const wia = await this.verifyWia(wiaJwt);

    // 2. Verify PoP is signed by the key bound in WIA
    const baseUrl = requestUrl.split('/api/')[0];
    await this.verifyClientAttestationPoP(popJwt, wia.cnf.jwk, baseUrl);

    this.logger.log(`WIA authenticated: wallet_instance=${wia.sub}, aal=${wia.aal || 'unknown'}`);
    return wia;
  }
}
```

**Step 2: Write the NestJS guard**

```typescript
// C:/dev/eguwallet-dgep/src/guards/wia-auth.guard.ts
import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { WiaAuthService } from '../services/wia-auth.service';

@Injectable()
export class WiaAuthGuard implements CanActivate {
  constructor(private readonly wiaAuthService: WiaAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const wia = await this.wiaAuthService.authenticate(
      request.headers,
      `${request.protocol}://${request.get('host')}${request.originalUrl}`,
    );
    request['wia'] = wia;
    return true;
  }
}
```

**Step 3: Commit**

```bash
cd /c/dev/eguwallet-dgep
git add src/services/wia-auth.service.ts src/guards/wia-auth.guard.ts
git commit -m "feat(dgep): add WIA authentication service and guard"
```

---

## Task 3: DGEP — Document Request Controller & Service

**Files:**
- Create: `C:/dev/eguwallet-dgep/src/services/document-request.service.ts`
- Create: `C:/dev/eguwallet-dgep/src/controllers/document-request.controller.ts`
- Modify: `C:/dev/eguwallet-dgep/src/dgep.module.ts` — register new controller + services

**Step 1: Write the document request service**

```typescript
// C:/dev/eguwallet-dgep/src/services/document-request.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PgService } from '../database';
import { PreAuthorizationService } from './pre-authorization.service';
import { CitizenService } from './citizen.service';
import { EmailService } from './email.service';

export interface SubmitDocumentRequestDto {
  documentType: 'CI' | 'ECI';
  email: string;
  phone?: string;
  documentScanFront: string;
  documentScanBack?: string;
  selfiePhoto: string;
}

export interface ApproveDocumentRequestDto {
  givenName: string;
  familyName: string;
  birthDate: string;
  cnp: string;
  gender: string;
  nationality?: string;
  residentAddress?: string;
  residentCity?: string;
  residentPostalCode?: string;
  residentCountry?: string;
  idSeries?: string;
  idNumber?: string;
  inspectorId: string;
  inspectorNotes?: string;
}

export interface RejectDocumentRequestDto {
  inspectorId: string;
  rejectionReason: string;
}

@Injectable()
export class DocumentRequestService {
  private readonly logger = new Logger(DocumentRequestService.name);

  constructor(
    private readonly pg: PgService,
    private readonly preAuthService: PreAuthorizationService,
    private readonly citizenService: CitizenService,
    private readonly emailService: EmailService,
  ) {}

  async submit(dto: SubmitDocumentRequestDto, walletInstanceId?: string): Promise<{ requestId: string; status: string }> {
    const result = await this.pg.queryOne<{ id: string }>(
      `INSERT INTO document_requests (document_type, email, phone, document_scan_front, document_scan_back, selfie_photo, wallet_instance_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [dto.documentType, dto.email, dto.phone || null, dto.documentScanFront, dto.documentScanBack || null, dto.selfiePhoto, walletInstanceId || null],
    );

    this.logger.log(`Document request created: ${result.id} (${dto.documentType}) for ${dto.email}`);
    return { requestId: result.id, status: 'pending_review' };
  }

  async getPendingRequests(): Promise<any[]> {
    return this.pg.query(
      `SELECT id, document_type, email, phone, status, created_at
       FROM document_requests
       WHERE status = 'pending_review'
       ORDER BY created_at ASC`,
    );
  }

  async getAllRequests(status?: string, limit = 50, offset = 0): Promise<any[]> {
    const params: any[] = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE status = $1`;
    }
    params.push(limit, offset);
    return this.pg.query(
      `SELECT id, document_type, email, phone, status, given_name, family_name, cnp, created_at, reviewed_at
       FROM document_requests
       ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
  }

  async getRequestById(id: string): Promise<any> {
    const request = await this.pg.queryOne(
      `SELECT * FROM document_requests WHERE id = $1`,
      [id],
    );
    if (!request) throw new NotFoundException(`Document request ${id} not found`);
    return request;
  }

  async approve(id: string, dto: ApproveDocumentRequestDto): Promise<{ requestId: string; credentialOfferUri: string }> {
    const request = await this.getRequestById(id);
    if (request.status !== 'pending_review') {
      throw new BadRequestException(`Request ${id} is not pending review (status: ${request.status})`);
    }

    // 1. Upsert citizen
    const citizen = await this.citizenService.upsertByCnp(dto.cnp, {
      given_name: dto.givenName,
      family_name: dto.familyName,
      birth_date: dto.birthDate,
      gender: dto.gender,
      nationality: dto.nationality || 'RO',
      resident_address: dto.residentAddress,
      resident_city: dto.residentCity,
      resident_postal_code: dto.residentPostalCode,
      resident_country: dto.residentCountry || 'RO',
      id_series: dto.idSeries,
      id_number: dto.idNumber,
    });

    // 2. Generate pre-authorization
    const preAuth = await this.preAuthService.create({
      citizenId: citizen.id,
      cnp: dto.cnp,
      pidRequestId: id,
    });

    // 3. Update document request
    await this.pg.query(
      `UPDATE document_requests SET
        status = 'approved',
        given_name = $2, family_name = $3, birth_date = $4, cnp = $5, gender = $6,
        nationality = $7, resident_address = $8, resident_city = $9,
        resident_postal_code = $10, resident_country = $11,
        id_series = $12, id_number = $13,
        inspector_id = $14, inspector_notes = $15,
        reviewed_at = NOW(), pre_authorization_id = $16, updated_at = NOW()
       WHERE id = $1`,
      [id, dto.givenName, dto.familyName, dto.birthDate, dto.cnp, dto.gender,
       dto.nationality || 'RO', dto.residentAddress, dto.residentCity,
       dto.residentPostalCode, dto.residentCountry || 'RO',
       dto.idSeries, dto.idNumber, dto.inspectorId, dto.inspectorNotes,
       preAuth.id],
    );

    // 4. Build credential offer
    const credentialOfferUri = preAuth.credentialOfferUri;

    // 5. Send email
    try {
      await this.emailService.sendCredentialOffer(
        request.email,
        `${dto.givenName} ${dto.familyName}`,
        credentialOfferUri,
        preAuth.txCode,
      );
      await this.pg.query(
        `UPDATE document_requests SET status = 'credential_offered', updated_at = NOW() WHERE id = $1`,
        [id],
      );
    } catch (error) {
      this.logger.error(`Failed to send credential offer email: ${error.message}`);
    }

    this.logger.log(`Document request ${id} approved by ${dto.inspectorId}`);
    return { requestId: id, credentialOfferUri };
  }

  async reject(id: string, dto: RejectDocumentRequestDto): Promise<void> {
    const request = await this.getRequestById(id);
    if (request.status !== 'pending_review') {
      throw new BadRequestException(`Request ${id} is not pending review`);
    }

    await this.pg.query(
      `UPDATE document_requests SET
        status = 'rejected', inspector_id = $2, rejection_reason = $3,
        reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id, dto.inspectorId, dto.rejectionReason],
    );

    try {
      await this.emailService.sendRejectionNotification(request.email, dto.rejectionReason);
    } catch (error) {
      this.logger.error(`Failed to send rejection email: ${error.message}`);
    }

    this.logger.log(`Document request ${id} rejected by ${dto.inspectorId}`);
  }

  async getStats(): Promise<any> {
    return this.pg.queryOne(
      `SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending_review') as pending,
        COUNT(*) FILTER (WHERE status = 'approved') as approved,
        COUNT(*) FILTER (WHERE status = 'credential_offered') as offered,
        COUNT(*) FILTER (WHERE status = 'rejected') as rejected,
        COUNT(*) FILTER (WHERE status = 'completed') as completed
       FROM document_requests`,
    );
  }
}
```

**Step 2: Write the controller**

```typescript
// C:/dev/eguwallet-dgep/src/controllers/document-request.controller.ts
import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Req, Logger } from '@nestjs/common';
import { DocumentRequestService, SubmitDocumentRequestDto, ApproveDocumentRequestDto, RejectDocumentRequestDto } from '../services/document-request.service';
import { WiaAuthGuard } from '../guards/wia-auth.guard';

@Controller('api/document-requests')
export class DocumentRequestController {
  private readonly logger = new Logger(DocumentRequestController.name);

  constructor(private readonly documentRequestService: DocumentRequestService) {}

  @Post()
  @UseGuards(WiaAuthGuard)
  async submit(@Body() dto: SubmitDocumentRequestDto, @Req() req: any) {
    const walletInstanceId = req.wia?.sub;
    return this.documentRequestService.submit(dto, walletInstanceId);
  }

  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.documentRequestService.getAllRequests(status, parseInt(limit || '50'), parseInt(offset || '0'));
  }

  @Get('pending')
  async pending() {
    return this.documentRequestService.getPendingRequests();
  }

  @Get('stats')
  async stats() {
    return this.documentRequestService.getStats();
  }

  @Get(':id')
  async getById(@Param('id') id: string) {
    return this.documentRequestService.getRequestById(id);
  }

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ApproveDocumentRequestDto) {
    return this.documentRequestService.approve(id, dto);
  }

  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectDocumentRequestDto) {
    return this.documentRequestService.reject(id, dto);
  }
}
```

**Step 3: Register in module**

Modify `C:/dev/eguwallet-dgep/src/dgep.module.ts`:
- Add `DocumentRequestController` to controllers array
- Add `DocumentRequestService` and `WiaAuthService` to providers array
- Add `WiaAuthGuard` to providers
- Import is already satisfied (HttpModule, ConfigModule, PgModule all already imported)

**Step 4: Commit**

```bash
cd /c/dev/eguwallet-dgep
git add src/services/document-request.service.ts src/controllers/document-request.controller.ts src/dgep.module.ts
git commit -m "feat(dgep): add document request REST API with WIA auth"
```

---

## Task 4: DGP — Database Migration for document_requests

**Files:**
- Create: `C:/dev/eguwallet-dgp/src/database/schemas/026-document-requests.sql`

**Step 1: Write the migration (passport variant)**

```sql
-- 026-document-requests.sql
-- Passport issuance requests submitted from Android wallet app

CREATE TABLE IF NOT EXISTS document_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(10) NOT NULL DEFAULT 'PASSPORT' CHECK (document_type = 'PASSPORT'),
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  document_scan_front TEXT NOT NULL,
  selfie_photo TEXT NOT NULL,
  wallet_instance_id VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected', 'credential_offered', 'completed')),

  -- Inspector fills these on approval
  first_name VARCHAR(255),
  last_name VARCHAR(255),
  date_of_birth DATE,
  gender VARCHAR(10),
  nationality VARCHAR(50),
  document_number VARCHAR(50),
  expiry_date DATE,
  issuing_state VARCHAR(10),
  personal_number VARCHAR(20),
  place_of_birth VARCHAR(255),
  permanent_address TEXT,

  -- Review metadata
  inspector_id VARCHAR(255),
  inspector_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  pre_authorization_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dgp_doc_requests_status ON document_requests(status);
CREATE INDEX idx_dgp_doc_requests_email ON document_requests(email);
CREATE INDEX idx_dgp_doc_requests_created ON document_requests(created_at DESC);
```

**Step 2: Commit**

```bash
cd /c/dev/eguwallet-dgp
git add src/database/schemas/026-document-requests.sql
git commit -m "feat(dgp): add document_requests table migration for passports"
```

---

## Task 5: DGP — WIA Auth + Document Request Controller & Service

**Files:**
- Create: `C:/dev/eguwallet-dgp/src/services/wia-auth.service.ts` (same as DGEP)
- Create: `C:/dev/eguwallet-dgp/src/guards/wia-auth.guard.ts` (same as DGEP)
- Create: `C:/dev/eguwallet-dgp/src/services/document-request.service.ts`
- Create: `C:/dev/eguwallet-dgp/src/controllers/document-request.controller.ts`
- Modify: `C:/dev/eguwallet-dgp/src/dgp.module.ts`

**Step 1: Copy WIA auth files from DGEP**

The `wia-auth.service.ts` and `wia-auth.guard.ts` are identical to DGEP (Task 2). Copy them.

**Step 2: Write DGP document request service**

```typescript
// C:/dev/eguwallet-dgp/src/services/document-request.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PgService } from '../database';
import { PreAuthorizationService } from './pre-authorization.service';
import { PassportService } from './passport.service';
import { EmailService } from './email.service';

export interface SubmitPassportDocumentRequestDto {
  documentType: 'PASSPORT';
  email: string;
  phone?: string;
  documentScanFront: string;
  selfiePhoto: string;
}

export interface ApprovePassportDocumentRequestDto {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  documentNumber: string;
  expiryDate: string;
  issuingState: string;
  personalNumber?: string;
  placeOfBirth?: string;
  permanentAddress?: string;
  inspectorId: string;
  inspectorNotes?: string;
}

export interface RejectPassportDocumentRequestDto {
  inspectorId: string;
  rejectionReason: string;
}

@Injectable()
export class DocumentRequestService {
  private readonly logger = new Logger(DocumentRequestService.name);

  constructor(
    private readonly pg: PgService,
    private readonly preAuthService: PreAuthorizationService,
    private readonly passportService: PassportService,
    private readonly emailService: EmailService,
  ) {}

  async submit(dto: SubmitPassportDocumentRequestDto, walletInstanceId?: string): Promise<{ requestId: string; status: string }> {
    const result = await this.pg.queryOne<{ id: string }>(
      `INSERT INTO document_requests (document_type, email, phone, document_scan_front, selfie_photo, wallet_instance_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [dto.documentType, dto.email, dto.phone || null, dto.documentScanFront, dto.selfiePhoto, walletInstanceId || null],
    );
    this.logger.log(`Passport document request created: ${result.id} for ${dto.email}`);
    return { requestId: result.id, status: 'pending_review' };
  }

  async getPendingRequests(): Promise<any[]> {
    return this.pg.query(
      `SELECT id, document_type, email, phone, status, created_at FROM document_requests WHERE status = 'pending_review' ORDER BY created_at ASC`,
    );
  }

  async getAllRequests(status?: string, limit = 50, offset = 0): Promise<any[]> {
    const params: any[] = [];
    let where = '';
    if (status) { params.push(status); where = `WHERE status = $1`; }
    params.push(limit, offset);
    return this.pg.query(
      `SELECT id, document_type, email, phone, status, first_name, last_name, document_number, created_at, reviewed_at
       FROM document_requests ${where} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`, params,
    );
  }

  async getRequestById(id: string): Promise<any> {
    const request = await this.pg.queryOne(`SELECT * FROM document_requests WHERE id = $1`, [id]);
    if (!request) throw new NotFoundException(`Document request ${id} not found`);
    return request;
  }

  async approve(id: string, dto: ApprovePassportDocumentRequestDto): Promise<{ requestId: string; credentialOfferUri: string }> {
    const request = await this.getRequestById(id);
    if (request.status !== 'pending_review') {
      throw new BadRequestException(`Request ${id} is not pending review`);
    }

    // 1. Create/update passport record
    const passport = await this.passportService.upsertByDocumentNumber(dto.documentNumber, {
      first_name: dto.firstName,
      last_name: dto.lastName,
      date_of_birth: dto.dateOfBirth,
      gender: dto.gender,
      nationality: dto.nationality,
      expiry_date: dto.expiryDate,
      issuing_state: dto.issuingState,
      personal_number: dto.personalNumber,
      place_of_birth: dto.placeOfBirth,
      permanent_address: dto.permanentAddress,
      email: request.email,
      phone: request.phone,
      foto_live: request.selfie_photo,
      read_successful: true,
      status: 'approved',
    });

    // 2. Generate pre-authorization
    const preAuth = await this.preAuthService.create({
      citizenId: passport.id,
      cnp: dto.personalNumber || dto.documentNumber,
      pidRequestId: id,
    });

    // 3. Update document request
    await this.pg.query(
      `UPDATE document_requests SET
        status = 'approved', first_name = $2, last_name = $3, date_of_birth = $4,
        gender = $5, nationality = $6, document_number = $7, expiry_date = $8,
        issuing_state = $9, personal_number = $10, place_of_birth = $11,
        permanent_address = $12, inspector_id = $13, inspector_notes = $14,
        reviewed_at = NOW(), pre_authorization_id = $15, updated_at = NOW()
       WHERE id = $1`,
      [id, dto.firstName, dto.lastName, dto.dateOfBirth, dto.gender, dto.nationality,
       dto.documentNumber, dto.expiryDate, dto.issuingState, dto.personalNumber,
       dto.placeOfBirth, dto.permanentAddress, dto.inspectorId, dto.inspectorNotes, preAuth.id],
    );

    // 4. Send credential offer email
    const credentialOfferUri = preAuth.credentialOfferUri;
    try {
      await this.emailService.sendCredentialOffer(
        request.email,
        `${dto.firstName} ${dto.lastName}`,
        credentialOfferUri,
        preAuth.txCode,
      );
      await this.pg.query(`UPDATE document_requests SET status = 'credential_offered', updated_at = NOW() WHERE id = $1`, [id]);
    } catch (error) {
      this.logger.error(`Failed to send credential offer email: ${error.message}`);
    }

    this.logger.log(`Passport request ${id} approved by ${dto.inspectorId}`);
    return { requestId: id, credentialOfferUri };
  }

  async reject(id: string, dto: RejectPassportDocumentRequestDto): Promise<void> {
    const request = await this.getRequestById(id);
    if (request.status !== 'pending_review') throw new BadRequestException(`Request ${id} is not pending review`);
    await this.pg.query(
      `UPDATE document_requests SET status = 'rejected', inspector_id = $2, rejection_reason = $3, reviewed_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [id, dto.inspectorId, dto.rejectionReason],
    );
    try { await this.emailService.sendRejectionNotification(request.email, dto.rejectionReason); } catch (e) { this.logger.error(`Rejection email failed: ${e.message}`); }
  }

  async getStats(): Promise<any> {
    return this.pg.queryOne(
      `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'pending_review') as pending, COUNT(*) FILTER (WHERE status = 'approved') as approved, COUNT(*) FILTER (WHERE status = 'credential_offered') as offered, COUNT(*) FILTER (WHERE status = 'rejected') as rejected, COUNT(*) FILTER (WHERE status = 'completed') as completed FROM document_requests`,
    );
  }
}
```

**Step 3: Write DGP controller** (same pattern as DGEP but with passport DTOs)

```typescript
// C:/dev/eguwallet-dgp/src/controllers/document-request.controller.ts
import { Controller, Post, Get, Patch, Body, Param, Query, UseGuards, Req, Logger } from '@nestjs/common';
import { DocumentRequestService, SubmitPassportDocumentRequestDto, ApprovePassportDocumentRequestDto, RejectPassportDocumentRequestDto } from '../services/document-request.service';
import { WiaAuthGuard } from '../guards/wia-auth.guard';

@Controller('api/document-requests')
export class DocumentRequestController {
  private readonly logger = new Logger(DocumentRequestController.name);

  constructor(private readonly documentRequestService: DocumentRequestService) {}

  @Post()
  @UseGuards(WiaAuthGuard)
  async submit(@Body() dto: SubmitPassportDocumentRequestDto, @Req() req: any) {
    return this.documentRequestService.submit(dto, req.wia?.sub);
  }

  @Get()
  async list(@Query('status') status?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.documentRequestService.getAllRequests(status, parseInt(limit || '50'), parseInt(offset || '0'));
  }

  @Get('pending')
  async pending() { return this.documentRequestService.getPendingRequests(); }

  @Get('stats')
  async stats() { return this.documentRequestService.getStats(); }

  @Get(':id')
  async getById(@Param('id') id: string) { return this.documentRequestService.getRequestById(id); }

  @Patch(':id/approve')
  async approve(@Param('id') id: string, @Body() dto: ApprovePassportDocumentRequestDto) { return this.documentRequestService.approve(id, dto); }

  @Patch(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectPassportDocumentRequestDto) { return this.documentRequestService.reject(id, dto); }
}
```

**Step 4: Register in DGP module** — add DocumentRequestController, DocumentRequestService, WiaAuthService, WiaAuthGuard to `dgp.module.ts`

**Step 5: Commit**

```bash
cd /c/dev/eguwallet-dgp
git add src/services/wia-auth.service.ts src/guards/wia-auth.guard.ts src/services/document-request.service.ts src/controllers/document-request.controller.ts src/dgp.module.ts
git commit -m "feat(dgp): add passport document request REST API with WIA auth"
```

---

## Task 6: DGP — Wire Credential Offer Email on Existing Approve

**Files:**
- Modify: `C:/dev/eguwallet-dgp/src/services/passport-request.service.ts`

The existing `PassportRequestService.approveRequest()` generates pre-auth but has TODO for email. Wire it up:

**Step 1: Find the approveRequest method and add email call**

After the line that generates pre-authorization, add:

```typescript
// After: const preAuth = await this.preAuthService.create(...)
try {
  await this.emailService.sendCredentialOffer(
    passport.email,
    `${passport.first_name} ${passport.last_name}`,
    preAuth.credentialOfferUri,
    preAuth.txCode,
  );
} catch (error) {
  this.logger.error(`Failed to send credential offer email: ${error.message}`);
}
```

**Step 2: Commit**

```bash
cd /c/dev/eguwallet-dgp
git add src/services/passport-request.service.ts
git commit -m "feat(dgp): wire credential offer email on passport approval"
```

---

## Task 7: Android — Client Attestation PoP Service

**Files:**
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/security/ClientAttestationService.kt`

**Step 1: Write the service**

```kotlin
// ClientAttestationService.kt
package com.eguwallet.wallet.security

import com.nimbusds.jose.*
import com.nimbusds.jose.crypto.ECDSASigner
import com.nimbusds.jose.jwk.ECKey
import com.nimbusds.jwt.JWTClaimsSet
import com.nimbusds.jwt.SignedJWT
import java.util.*
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ClientAttestationService @Inject constructor(
    private val keyManagement: UnifiedKeyManagementService,
    private val dpopManager: DPoPManager
) {
    companion object {
        private const val POP_VALIDITY_SECONDS = 300L // 5 minutes
    }

    /**
     * Creates a Client-Attestation-PoP JWT per draft-ietf-oauth-attestation-based-client-auth.
     * This proves the wallet instance possesses the key bound in the WIA.
     */
    fun createClientAttestationPoP(audience: String): String {
        val keyPair = keyManagement.getOrCreateKeyPair(
            alias = "wallet_instance_key",
            purpose = UnifiedKeyManagementService.KeyPurpose.WALLET_INSTANCE
        )
        val ecKey = ECKey.Builder(keyPair.toECKey()).build()
        val now = Date()
        val exp = Date(now.time + POP_VALIDITY_SECONDS * 1000)

        val claims = JWTClaimsSet.Builder()
            .issuer(keyManagement.getWalletInstanceId())
            .audience(audience)
            .jwtID(UUID.randomUUID().toString())
            .issueTime(now)
            .expirationTime(exp)
            .build()

        val header = JWSHeader.Builder(JWSAlgorithm.ES256)
            .type(JOSEObjectType("wallet-attestation-pop+jwt"))
            .jwk(ecKey.toPublicJWK())
            .build()

        val signedJwt = SignedJWT(header, claims)
        signedJwt.sign(ECDSASigner(ecKey))
        return signedJwt.serialize()
    }
}
```

**Step 2: Register in Hilt module**

Add `@Singleton` `ClientAttestationService` — already injectable via constructor injection with `@Inject`.

**Step 3: Commit**

```bash
cd /c/dev/eguwallet-android
git add app/src/main/java/com/eguwallet/wallet/security/ClientAttestationService.kt
git commit -m "feat(android): add Client-Attestation-PoP service for WIA auth"
```

---

## Task 8: Android — Document Request API Service

**Files:**
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/data/api/DocumentRequestApiService.kt`
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/data/models/DocumentRequest.kt`
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/data/repository/DocumentRequestRepository.kt`

**Step 1: Write the data models**

```kotlin
// DocumentRequest.kt
package com.eguwallet.wallet.data.models

enum class DocumentType(val value: String, val targetService: String) {
    CI("CI", "dgep"),
    ECI("ECI", "dgep"),
    PASSPORT("PASSPORT", "dgp");

    val baseUrl: String get() = when (targetService) {
        "dgep" -> "https://dgep.eguwallet.eu"
        "dgp" -> "https://dgp.eguwallet.eu"
        else -> throw IllegalStateException("Unknown service: $targetService")
    }
}

data class DocumentRequestBody(
    val documentType: String,
    val email: String,
    val phone: String?,
    val documentScanFront: String,  // base64
    val documentScanBack: String?,  // base64, null for passport
    val selfiePhoto: String         // base64
)

data class DocumentRequestResponse(
    val requestId: String,
    val status: String
)
```

**Step 2: Write the API service**

```kotlin
// DocumentRequestApiService.kt
package com.eguwallet.wallet.data.api

import com.eguwallet.wallet.data.models.DocumentRequestBody
import com.eguwallet.wallet.data.models.DocumentRequestResponse
import retrofit2.http.Body
import retrofit2.http.Header
import retrofit2.http.POST

interface DocumentRequestApiService {
    @POST("api/document-requests")
    suspend fun submitDocumentRequest(
        @Header("Client-Attestation") wia: String,
        @Header("Client-Attestation-PoP") pop: String,
        @Header("DPoP") dpop: String,
        @Body body: DocumentRequestBody
    ): DocumentRequestResponse
}
```

**Step 3: Write the repository**

```kotlin
// DocumentRequestRepository.kt
package com.eguwallet.wallet.data.repository

import android.util.Log
import com.eguwallet.wallet.data.api.DocumentRequestApiService
import com.eguwallet.wallet.data.models.*
import com.eguwallet.wallet.security.ClientAttestationService
import com.eguwallet.wallet.security.DPoPManager
import com.eguwallet.wallet.security.attestation.AttestationService
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class DocumentRequestRepository @Inject constructor(
    private val attestationService: AttestationService,
    private val clientAttestationService: ClientAttestationService,
    private val dpopManager: DPoPManager,
    private val okHttpClient: OkHttpClient
) {
    companion object {
        private const val TAG = "DocumentRequestRepo"
    }

    private fun buildApi(baseUrl: String): DocumentRequestApiService {
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(okHttpClient)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
            .create(DocumentRequestApiService::class.java)
    }

    suspend fun submitRequest(
        documentType: DocumentType,
        email: String,
        phone: String?,
        documentScanFront: ByteArray,
        documentScanBack: ByteArray?,
        selfiePhoto: ByteArray
    ): DocumentRequestResponse {
        val baseUrl = documentType.baseUrl
        val endpoint = "$baseUrl/api/document-requests"

        // 1. Get or refresh WIA
        attestationService.refreshAttestationIfNeeded()
        val wia = attestationService.currentAttestation.value?.attestationJwt
            ?: throw IllegalStateException("No wallet attestation available")

        // 2. Create Client-Attestation-PoP
        val pop = clientAttestationService.createClientAttestationPoP(baseUrl)

        // 3. Create DPoP proof
        val dpop = dpopManager.generateDPoPProof("POST", endpoint)

        // 4. Build request body
        val body = DocumentRequestBody(
            documentType = documentType.value,
            email = email,
            phone = phone,
            documentScanFront = android.util.Base64.encodeToString(documentScanFront, android.util.Base64.NO_WRAP),
            documentScanBack = documentScanBack?.let { android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP) },
            selfiePhoto = android.util.Base64.encodeToString(selfiePhoto, android.util.Base64.NO_WRAP)
        )

        Log.i(TAG, "Submitting ${documentType.value} request to $baseUrl")
        val api = buildApi(baseUrl)
        return api.submitDocumentRequest(wia, pop, dpop, body)
    }
}
```

**Step 4: Commit**

```bash
cd /c/dev/eguwallet-android
git add app/src/main/java/com/eguwallet/wallet/data/models/DocumentRequest.kt \
        app/src/main/java/com/eguwallet/wallet/data/api/DocumentRequestApiService.kt \
        app/src/main/java/com/eguwallet/wallet/data/repository/DocumentRequestRepository.kt
git commit -m "feat(android): add document request API service with WIA+DPoP auth"
```

---

## Task 9: Android — Wizard ViewModel

**Files:**
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ui/viewmodels/DocumentRequestViewModel.kt`

**Step 1: Write the ViewModel**

```kotlin
// DocumentRequestViewModel.kt
package com.eguwallet.wallet.ui.viewmodels

import android.graphics.Bitmap
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.eguwallet.wallet.data.models.DocumentType
import com.eguwallet.wallet.data.repository.DocumentRequestRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.ByteArrayOutputStream
import javax.inject.Inject

enum class WizardStep { SELECT_TYPE, SCAN_DOCUMENT, TAKE_SELFIE, SUBMITTING, SUCCESS, ERROR }

data class WizardState(
    val step: WizardStep = WizardStep.SELECT_TYPE,
    val documentType: DocumentType? = null,
    val documentFrontScan: ByteArray? = null,
    val documentBackScan: ByteArray? = null,
    val selfiePhoto: ByteArray? = null,
    val isSubmitting: Boolean = false,
    val requestId: String? = null,
    val errorMessage: String? = null,
    val needsBackScan: Boolean = false
)

@HiltViewModel
class DocumentRequestViewModel @Inject constructor(
    private val repository: DocumentRequestRepository
) : ViewModel() {

    private val _state = MutableStateFlow(WizardState())
    val state: StateFlow<WizardState> = _state

    fun selectDocumentType(type: DocumentType) {
        _state.value = _state.value.copy(
            documentType = type,
            needsBackScan = type != DocumentType.PASSPORT,
            step = WizardStep.SCAN_DOCUMENT
        )
    }

    fun setDocumentFrontScan(bitmap: Bitmap) {
        _state.value = _state.value.copy(documentFrontScan = bitmapToBytes(bitmap))
    }

    fun setDocumentBackScan(bitmap: Bitmap) {
        _state.value = _state.value.copy(documentBackScan = bitmapToBytes(bitmap))
    }

    fun onDocumentScanComplete() {
        _state.value = _state.value.copy(step = WizardStep.TAKE_SELFIE)
    }

    fun setSelfiePhoto(bitmap: Bitmap) {
        _state.value = _state.value.copy(
            selfiePhoto = bitmapToBytes(bitmap),
            step = WizardStep.SUBMITTING
        )
        submitRequest()
    }

    private fun submitRequest() {
        val s = _state.value
        val docType = s.documentType ?: return
        val front = s.documentFrontScan ?: return
        val selfie = s.selfiePhoto ?: return

        _state.value = s.copy(isSubmitting = true)

        viewModelScope.launch {
            try {
                val result = repository.submitRequest(
                    documentType = docType,
                    email = getUserEmail(),
                    phone = getUserPhone(),
                    documentScanFront = front,
                    documentScanBack = s.documentBackScan,
                    selfiePhoto = selfie
                )
                _state.value = _state.value.copy(
                    step = WizardStep.SUCCESS,
                    requestId = result.requestId,
                    isSubmitting = false
                )
            } catch (e: Exception) {
                _state.value = _state.value.copy(
                    step = WizardStep.ERROR,
                    errorMessage = e.message ?: "Submission failed",
                    isSubmitting = false
                )
            }
        }
    }

    fun retry() {
        _state.value = _state.value.copy(step = WizardStep.SUBMITTING, errorMessage = null)
        submitRequest()
    }

    fun reset() {
        _state.value = WizardState()
    }

    private fun getUserEmail(): String {
        // TODO: get from wallet user profile / DataStore
        return ""
    }

    private fun getUserPhone(): String? {
        // TODO: get from wallet user profile / DataStore
        return null
    }

    private fun bitmapToBytes(bitmap: Bitmap): ByteArray {
        val stream = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 85, stream)
        return stream.toByteArray()
    }
}
```

**Step 2: Commit**

```bash
cd /c/dev/eguwallet-android
git add app/src/main/java/com/eguwallet/wallet/ui/viewmodels/DocumentRequestViewModel.kt
git commit -m "feat(android): add document request wizard ViewModel"
```

---

## Task 10: Android — Wizard UI Screens (Replace Onboarding)

**Files:**
- Replace: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ui/screens/onboarding/OnboardingScreen.kt`
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ui/screens/onboarding/DocumentTypeSelectionScreen.kt`
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ui/screens/onboarding/DocumentScanScreen.kt`
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ui/screens/onboarding/SelfieCaptureWizardScreen.kt`
- Create: `C:/dev/eguwallet-android/app/src/main/java/com/eguwallet/wallet/ui/screens/onboarding/SubmissionResultScreen.kt`

This is a large UI task. Key implementation notes:

**Step 1: Write DocumentTypeSelectionScreen (Step 1 of wizard)**

Material 3 cards with: title, description, icon for each document type. Stepper indicator at top showing 4 steps.

**Step 2: Write DocumentScanScreen (Step 2 of wizard)**

Reuse existing `MRZCameraCapture.kt` camera logic. Add ML Kit Document Scanner for cleaner captures. Two-step for CI/ECI (front + back), one-step for passport.

**Step 3: Write SelfieCaptureWizardScreen (Step 3 of wizard)**

Reuse existing selfie capture logic from `SelfieCaptureScreen`. Add oval face guide overlay. ML Kit face detection for auto-capture.

**Step 4: Write SubmissionResultScreen (Step 4 — success/error)**

Shows progress during submission, success message with "check your email", or error with retry.

**Step 5: Rewrite OnboardingScreen as wizard router**

Replace tabbed layout with state-driven wizard that routes to the correct step based on ViewModel state.

```kotlin
// OnboardingScreen.kt (rewritten)
@Composable
fun OnboardingScreen(viewModel: DocumentRequestViewModel = hiltViewModel(), onBack: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    when (state.step) {
        WizardStep.SELECT_TYPE -> DocumentTypeSelectionScreen(onSelect = viewModel::selectDocumentType, onBack = onBack)
        WizardStep.SCAN_DOCUMENT -> DocumentScanScreen(state = state, viewModel = viewModel)
        WizardStep.TAKE_SELFIE -> SelfieCaptureWizardScreen(onCapture = viewModel::setSelfiePhoto)
        WizardStep.SUBMITTING -> SubmissionResultScreen(isLoading = true)
        WizardStep.SUCCESS -> SubmissionResultScreen(isLoading = false, requestId = state.requestId, onDone = { viewModel.reset(); onBack() })
        WizardStep.ERROR -> SubmissionResultScreen(isLoading = false, error = state.errorMessage, onRetry = viewModel::retry, onBack = onBack)
    }
}
```

**Step 6: Commit**

```bash
cd /c/dev/eguwallet-android
git add app/src/main/java/com/eguwallet/wallet/ui/screens/onboarding/
git commit -m "feat(android): replace onboarding with document request wizard UI"
```

---

## Task 11: DGEP — Admin Angular Frontend

**Files:**
- Create: `C:/dev/eguwallet-dgep/frontend/` — full Angular 21 application

**Step 1: Scaffold Angular app**

```bash
cd /c/dev/eguwallet-dgep
npx @angular/cli@21 new frontend --standalone --routing --style=css --skip-git --skip-tests
cd frontend
npm install primeng@21 @primeuix/themes tailwindcss-primeui tailwindcss@4
```

**Step 2: Create admin pages**

- `src/app/pages/login/` — OIDC login
- `src/app/pages/dashboard/` — pending count, stats cards
- `src/app/pages/request-list/` — PrimeNG DataTable with status filter
- `src/app/pages/request-detail/` — two-column: images left, form right, approve/reject bottom
- `src/app/services/api.service.ts` — HTTP calls to DGEP backend

**Step 3: Request detail page layout**

Left panel: `p-image` components showing document scans (zoomable). Right panel: reactive form with `p-inputtext` for all PID fields (given_name, family_name, birth_date, cnp, gender, nationality, address fields, id_series, id_number). Bottom: `p-button` for Approve (severity success) and Reject (severity danger, opens `p-dialog` for reason).

**Step 4: Update DGEP Dockerfile to build frontend**

```dockerfile
# Stage 1: Build Angular frontend
FROM node:22-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx ng build --configuration production

# Stage 2: Build NestJS backend
FROM oven/bun:1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile || bun install
COPY . .
RUN bun run build

# Stage 3: Production
FROM oven/bun:1-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3010
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid nodejs nodejs
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=frontend --chown=nodejs:nodejs /app/frontend/dist/frontend/browser ./dist/admin
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
USER nodejs
EXPOSE 3010
CMD ["bun", "run", "dist/main.js"]
```

**Step 5: Add static file serving in NestJS main.ts**

```typescript
// In main.ts, add after app creation:
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
app.useStaticAssets(join(__dirname, 'admin'), { prefix: '/admin/' });
```

**Step 6: Commit**

```bash
cd /c/dev/eguwallet-dgep
git add frontend/ Dockerfile src/main.ts
git commit -m "feat(dgep): add Angular admin frontend for document request review"
```

---

## Task 12: DGP — Admin Angular Frontend

**Files:**
- Create: `C:/dev/eguwallet-dgp/frontend/` — same pattern as DGEP

**Step 1: Scaffold and build** — same as Task 11 but with passport-specific form fields

**Step 2: Request detail form fields**

Passport form: first_name, last_name, nationality, date_of_birth, gender, document_number, expiry_date, issuing_state, personal_number, place_of_birth, permanent_address.

**Step 3: Update Dockerfile** — same multi-stage pattern, PORT=3011

**Step 4: Commit**

```bash
cd /c/dev/eguwallet-dgp
git add frontend/ Dockerfile src/main.ts
git commit -m "feat(dgp): add Angular admin frontend for passport request review"
```

---

## Task 13: Apply Database Migrations + Push All

**Step 1: Apply DGEP migration**

```bash
psql -h localhost -U postgres -d eguwallet_dgep -f /c/dev/eguwallet-dgep/src/database/schemas/026-document-requests.sql
```

**Step 2: Apply DGP migration**

```bash
psql -h localhost -U postgres -d eguwallet_dgp -f /c/dev/eguwallet-dgp/src/database/schemas/026-document-requests.sql
```

**Step 3: Push all repos**

```bash
cd /c/dev/eguwallet-dgep && git push
cd /c/dev/eguwallet-dgp && git push
cd /c/dev/eguwallet-android && git push
```

**Step 4: Verify CI/CD deploys successfully**

```bash
gh run list --repo eguilde/eguwallet-dgep --limit 1
gh run list --repo eguilde/eguwallet-dgp --limit 1
```

---

## Task Order & Dependencies

```
Task 1 (DGEP migration) ──► Task 2 (WIA auth) ──► Task 3 (DGEP controller) ──► Task 11 (DGEP admin)
Task 4 (DGP migration) ──► Task 5 (DGP controller) ──► Task 6 (DGP email) ──► Task 12 (DGP admin)
Task 7 (Android PoP) ──► Task 8 (Android API) ──► Task 9 (Android VM) ──► Task 10 (Android UI)
Task 13 (migrations + deploy) depends on all above
```

Tasks 1-3, 4-6, and 7-10 can run in parallel across 3 workstreams.
