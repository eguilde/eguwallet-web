# eguwallet.com Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Migrate all wallet backend services from a single `wallet.eguilde.cloud` domain with a central api-gateway to independent per-service subdomains on `eguwallet.com`, each with its own OIDC provider, PostgreSQL database, Angular frontend, and Docker compose stack.

**Architecture:** NestJS monorepo (`C:\dev\eguilde_wallet\monoback`) with per-service Docker compose stacks. OIDC logic extracted from api-gateway into shared `libs/oidc/` lib. Angular frontends built in a new `frontends/` workspace, served as static files by NestJS. egucluster1 runs nginx + wildcard Let's Encrypt cert. Services run on egucluster3.

**Tech Stack:** NestJS 10, oidc-provider v9, bun, PostgreSQL, Angular 21, PrimeNG, TailwindCSS 4, nginx, certbot-dns-godaddy, Docker compose

**Reference:** Design doc at `docs/plans/2026-02-21-eguwallet-redesign-design.md` in eguilde repo.

**DGEP is excluded** — it is already being reworked separately.

---

## Service Map

| Service | Subdomain | egucluster3 port | DB name |
|---|---|---|---|
| qtsp | qtsp.eguwallet.com | 3003 | eguwallet_qtsp |
| lotl | lotl.eguwallet.com | 3002 | eguwallet_lotl |
| certification | cert.eguwallet.com | 3001 | eguwallet_cert |
| wallet-provider | wallet.eguwallet.com | 3210 | eguwallet_wallet |
| dgp | dgp.eguwallet.com | 3011 | eguwallet_dgp |

**Default admin seeded in every service:** `thomas@eguilde.cloud`

---

## Phase 0: Infrastructure

### Task 1: Create GoDaddy wildcard DNS records for eguwallet.com

**Files:** none (GoDaddy API call)

**Context:** GoDaddy API keys are in `backend/.env` in the eguilde repo (`GODADDY_API_KEY`, `GODADDY_API_SECRET`, `GODADDY_DOMAIN`). Run from any machine.

**Step 1: Get current egucluster1 public IP**

SSH to egucluster1 and get its IP:
```bash
ssh eguilde@egucluster1.eguilde.cloud 'curl -s https://api.ipify.org'
```
Note the IP (call it `CLUSTER1_IP`).

**Step 2: Create wildcard A record via GoDaddy API**

```bash
# Replace GODADDY_KEY, GODADDY_SECRET, CLUSTER1_IP with actual values
curl -s -X PUT \
  "https://api.godaddy.com/v1/domains/eguwallet.com/records/A/%2A" \
  -H "Authorization: sso-key GODADDY_KEY:GODADDY_SECRET" \
  -H "Content-Type: application/json" \
  -d '[{"data":"CLUSTER1_IP","ttl":600}]'

# Create root A record too
curl -s -X PUT \
  "https://api.godaddy.com/v1/domains/eguwallet.com/records/A/%40" \
  -H "Authorization: sso-key GODADDY_KEY:GODADDY_SECRET" \
  -H "Content-Type: application/json" \
  -d '[{"data":"CLUSTER1_IP","ttl":600}]'
```

**Step 3: Verify DNS propagation**

```bash
dig +short wallet.eguwallet.com A
dig +short qtsp.eguwallet.com A
# Expected: both return CLUSTER1_IP
```

**Step 4: Commit nothing (infrastructure only)**

---

### Task 2: Install certbot + dns-godaddy on egucluster1 and issue wildcard cert

**Files:** `/etc/letsencrypt/godaddy.ini` on egucluster1

**Context:** SSH user `eguilde@egucluster1.eguilde.cloud`, sudo password `Egu45ilde`.

**Step 1: SSH to egucluster1 and install certbot**

```bash
ssh eguilde@egucluster1.eguilde.cloud
sudo apt-get update && sudo apt-get install -y certbot python3-pip
sudo pip3 install certbot-dns-godaddy
```

**Step 2: Create GoDaddy credentials file**

```bash
sudo mkdir -p /etc/letsencrypt
sudo tee /etc/letsencrypt/godaddy.ini > /dev/null <<'EOF'
dns_godaddy_secret = YOUR_GODADDY_API_SECRET
dns_godaddy_key    = YOUR_GODADDY_API_KEY
EOF
sudo chmod 600 /etc/letsencrypt/godaddy.ini
```
Replace `YOUR_GODADDY_API_SECRET` and `YOUR_GODADDY_API_KEY` with actual values from eguilde `.env`.

**Step 3: Issue wildcard certificate**

```bash
sudo certbot certonly \
  --authenticator dns-godaddy \
  --dns-godaddy-credentials /etc/letsencrypt/godaddy.ini \
  --dns-godaddy-propagation-seconds 60 \
  -d "eguwallet.com" \
  -d "*.eguwallet.com" \
  --agree-tos \
  --email thomas@eguilde.cloud \
  --non-interactive
```

Expected output: `Certificate is saved at: /etc/letsencrypt/live/eguwallet.com/fullchain.pem`

**Step 4: Set up auto-renewal cron**

```bash
(sudo crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'nginx -s reload'") | sudo crontab -
```

**Step 5: Verify cert**

```bash
sudo certbot certificates
# Expected: eguwallet.com + *.eguwallet.com listed, valid 90 days
```

---

### Task 3: Configure nginx on egucluster1

**Files:** `/etc/nginx/sites-available/eguwallet.conf` on egucluster1

**Step 1: Install nginx if not present**

```bash
sudo apt-get install -y nginx
```

**Step 2: Create nginx config**

```bash
sudo tee /etc/nginx/sites-available/eguwallet.conf > /dev/null <<'NGINX'
# HTTP → HTTPS redirect
server {
    listen 80;
    server_name eguwallet.com *.eguwallet.com;
    return 301 https://$host$request_uri;
}

# SSL settings (shared)
map $host $upstream_port {
    wallet.eguwallet.com   3210;
    lotl.eguwallet.com     3002;
    cert.eguwallet.com     3001;
    qtsp.eguwallet.com     3003;
    dgp.eguwallet.com      3011;
    dgep.eguwallet.com     3010;
    default                3003;
}

server {
    listen 443 ssl http2;
    server_name *.eguwallet.com eguwallet.com;

    ssl_certificate     /etc/letsencrypt/live/eguwallet.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eguwallet.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    client_max_body_size 10m;

    location / {
        proxy_pass         http://egucluster3.eguilde.cloud:$upstream_port;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;
        proxy_connect_timeout 10s;
    }
}
NGINX
```

**Step 3: Enable config and reload**

```bash
sudo ln -sf /etc/nginx/sites-available/eguwallet.conf /etc/nginx/sites-enabled/eguwallet.conf
sudo nginx -t
# Expected: nginx: configuration file /etc/nginx/nginx.conf test is successful
sudo systemctl reload nginx
```

**Step 4: Verify nginx is running**

```bash
sudo systemctl status nginx
# Expected: active (running)
curl -I https://qtsp.eguwallet.com/health 2>&1 | head -5
# Expected: 502 or 200 (502 is fine — service not deployed yet, but SSL works)
```

---

## Phase 1: Shared OIDC Library

### Task 4: Create `libs/oidc/` shared library in monoback

**Context:** Working directory: `C:\dev\eguilde_wallet\monoback`

The api-gateway already has a working OIDC implementation in `apps/api-gateway/src/oidc/`. We extract and adapt it into a shared lib. Each service will import `@app/oidc`. We use **oidc-provider v9** (aligned with eguilde project).

**Files to create:**
- `libs/oidc/src/index.ts`
- `libs/oidc/src/oidc.module.ts`
- `libs/oidc/src/oidc.service.ts`
- `libs/oidc/src/oidc.controller.ts`
- `libs/oidc/src/adapters/pg.adapter.ts`
- `libs/oidc/src/interactions/interactions.controller.ts`
- `libs/oidc/src/interactions/interactions.service.ts`
- `libs/oidc/src/interactions/otp.service.ts`
- `libs/oidc/src/users/users.service.ts`
- `libs/oidc/src/auth/auth.controller.ts`
- `libs/oidc/tsconfig.lib.json`
- `libs/oidc/package.json` (not needed — NestJS lib, uses workspace)

**Step 1: Register lib in nest-cli.json**

Add to `nest-cli.json` under `"projects"`:

```json
"oidc": {
  "type": "library",
  "root": "libs/oidc",
  "entryFile": "index",
  "sourceRoot": "libs/oidc/src",
  "compilerOptions": {
    "tsConfigPath": "libs/oidc/tsconfig.lib.json"
  }
}
```

**Step 2: Create tsconfig.lib.json**

Create `libs/oidc/tsconfig.lib.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "outDir": "../../dist/libs/oidc"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*spec.ts"]
}
```

Also add path mapping in root `tsconfig.json` under `paths`:
```json
"@app/oidc": ["libs/oidc/src/index.ts"]
```

**Step 3: Install oidc-provider v9**

```bash
bun add oidc-provider@^9.0.0
bun add -d @types/oidc-provider
```

**Step 4: Create `libs/oidc/src/adapters/pg.adapter.ts`**

This is a direct copy of eguilde's pg adapter, adapted to use `PgService` from `@app/database`:

```typescript
// libs/oidc/src/adapters/pg.adapter.ts
import { PgService } from '@app/database';

interface OidcPayload extends Record<string, unknown> {
  grantId?: string;
  userCode?: string;
  uid?: string;
  consumed?: boolean;
}

interface OidcModelRow {
  model_id: string;
  model_name: string;
  payload: OidcPayload;
  grant_id: string | null;
  user_code: string | null;
  uid: string | null;
  expires_at: Date | null;
  consumed_at: Date | null;
}

export class PgAdapter {
  constructor(
    private readonly name: string,
    private readonly pg: PgService,
  ) {}

  async upsert(id: string, payload: OidcPayload, expiresIn?: number): Promise<void> {
    const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;
    await this.pg.query(
      `INSERT INTO oidc_models (model_id, model_name, payload, grant_id, user_code, uid, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (model_id, model_name) DO UPDATE SET
         payload = EXCLUDED.payload,
         grant_id = EXCLUDED.grant_id,
         user_code = EXCLUDED.user_code,
         uid = EXCLUDED.uid,
         expires_at = EXCLUDED.expires_at`,
      [id, this.name, JSON.stringify(payload), payload.grantId ?? null,
       payload.userCode ?? null, payload.uid ?? null, expiresAt],
    );
  }

  async find(id: string): Promise<OidcPayload | undefined> {
    const rows = await this.pg.query<OidcModelRow>(
      `SELECT * FROM oidc_models WHERE model_id = $1 AND model_name = $2`,
      [id, this.name],
    );
    const row = rows[0];
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < new Date()) return undefined;
    return { ...row.payload, ...(row.consumed_at ? { consumed: true } : {}) };
  }

  async findByUid(uid: string): Promise<OidcPayload | undefined> {
    const rows = await this.pg.query<OidcModelRow>(
      `SELECT * FROM oidc_models WHERE uid = $1 AND model_name = $2`,
      [uid, this.name],
    );
    const row = rows[0];
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < new Date()) return undefined;
    return { ...row.payload, ...(row.consumed_at ? { consumed: true } : {}) };
  }

  async findByUserCode(userCode: string): Promise<OidcPayload | undefined> {
    const rows = await this.pg.query<OidcModelRow>(
      `SELECT * FROM oidc_models WHERE user_code = $1 AND model_name = $2`,
      [userCode, this.name],
    );
    const row = rows[0];
    if (!row) return undefined;
    if (row.expires_at && row.expires_at < new Date()) return undefined;
    return { ...row.payload };
  }

  async destroy(id: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM oidc_models WHERE model_id = $1 AND model_name = $2`,
      [id, this.name],
    );
  }

  async consume(id: string): Promise<void> {
    await this.pg.query(
      `UPDATE oidc_models SET consumed_at = NOW() WHERE model_id = $1 AND model_name = $2`,
      [id, this.name],
    );
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    await this.pg.query(
      `DELETE FROM oidc_models WHERE grant_id = $1`,
      [grantId],
    );
  }
}

export function createAdapterFactory(pg: PgService) {
  return (name: string) => new PgAdapter(name, pg);
}
```

**Step 5: Create `libs/oidc/src/oidc.service.ts`**

Stripped-down version of eguilde's oidc.service.ts — no wallet attestation, no passkey, no pairwise, OTP-only login. Configured for admin panels.

```typescript
// libs/oidc/src/oidc.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import type { Request, Response } from 'express';
import Provider from 'oidc-provider';
import { PgService } from '@app/database';
import { createAdapterFactory } from './adapters/pg.adapter';

interface UserRow {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  active: boolean;
  updated_at: Date;
}

@Injectable()
export class OidcService implements OnModuleInit {
  private readonly logger = new Logger(OidcService.name);
  private provider: Provider;

  constructor(
    private readonly configService: ConfigService,
    private readonly pg: PgService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.syncClientRedirectUris();
    await this.initializeProvider();
  }

  getProvider(): Provider { return this.provider; }

  interactionDetails(req: Request, res: Response): Promise<unknown> {
    return (this.provider as any).interactionDetails(req, res);
  }

  interactionFinished(req: Request, res: Response, result: Record<string, unknown>): Promise<void> {
    return (this.provider as any).interactionFinished(req, res, result, { mergeWithLastSubmission: false });
  }

  private async initializeProvider(): Promise<void> {
    const port = this.configService.get<number>('PORT', 3003);
    const issuer = this.configService.get<string>('OIDC_ISSUER', `http://localhost:${port}/oidc`);
    const apiResource = this.configService.get<string>('API_RESOURCE', `http://localhost:${port}/api`);
    const isProduction = this.configService.get('NODE_ENV') === 'production';
    const frontendOrigin = this.configService.get<string>('FRONTEND_ORIGIN', `http://localhost:4200`);

    const jwks = await this.getOrCreateJwks();
    const cookieKeys = await this.getOrCreateCookieKeys();
    const clients = await this.loadClients();
    const adapterFactory = createAdapterFactory(this.pg);

    const configuration: Record<string, unknown> = {
      adapter: adapterFactory,
      clients,
      findAccount: async (_ctx: unknown, sub: string) => {
        const rows = await this.pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [parseInt(sub)]);
        const user = rows[0];
        if (!user || !user.active) return undefined;
        return {
          accountId: String(user.id),
          claims(_use: string, scope: string[]): Record<string, unknown> {
            const data: Record<string, unknown> = { sub: String(user.id), roles: user.roles };
            if (scope.includes('profile')) {
              data.name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
              data.given_name = user.first_name;
              data.family_name = user.last_name;
              data.preferred_username = user.email;
              data.updated_at = Math.floor(new Date(user.updated_at).getTime() / 1000);
            }
            if (scope.includes('email')) { data.email = user.email; data.email_verified = true; }
            return data;
          },
        };
      },
      loadExistingGrant: async (ctx: any) => {
        const grantId = ctx.oidc.result?.consent?.grantId || ctx.oidc.session?.grantIdFor(ctx.oidc.client.clientId);
        if (grantId) {
          const existing = await ctx.oidc.provider.Grant.find(grantId);
          if (existing) return existing;
        }
        // Auto-grant for first-party SPA
        if (ctx.oidc.session?.accountId) {
          const grant = new ctx.oidc.provider.Grant({
            accountId: ctx.oidc.session.accountId,
            clientId: ctx.oidc.client.clientId,
          });
          grant.addOIDCScope('openid profile email offline_access');
          grant.addOIDCClaims(['sub', 'roles', 'name', 'given_name', 'family_name', 'preferred_username', 'updated_at', 'email', 'email_verified']);
          grant.addResourceScope(apiResource, 'openid profile email offline_access');
          await grant.save();
          return grant;
        }
        return undefined;
      },
      interactions: {
        url(_ctx: unknown, interaction: { uid: string }) {
          return `/interactions/${interaction.uid}`;
        },
      },
      features: {
        devInteractions: { enabled: false },
        userinfo: { enabled: true },
        revocation: { enabled: true },
        rpInitiatedLogout: {
          enabled: true,
          postLogoutSuccessSource: (ctx: any): void => {
            const redirect = ctx.oidc?.params?.post_logout_redirect_uri || frontendOrigin;
            ctx.redirect(redirect);
          },
        },
        resourceIndicators: {
          enabled: true,
          defaultResource: (_ctx: unknown, _client: unknown, oneOf: string | undefined) => oneOf || apiResource,
          useGrantedResource: () => true,
          getResourceServerInfo: (_ctx: unknown, resourceIndicator: string) => {
            if (resourceIndicator === apiResource) {
              return { scope: 'openid profile email offline_access', audience: resourceIndicator, accessTokenTTL: 900, accessTokenFormat: 'jwt', jwt: { sign: { alg: 'RS256' } } };
            }
            throw new Error(`Unknown resource indicator: ${resourceIndicator}`);
          },
        },
      },
      pkce: { required: () => true },
      extraTokenClaims: async (_ctx: unknown, token: { accountId?: string }) => {
        if (!token.accountId) return undefined;
        const rows = await this.pg.query<UserRow>('SELECT * FROM users WHERE id = $1', [parseInt(token.accountId)]);
        const user = rows[0];
        if (!user) return undefined;
        return { roles: user.roles, email: user.email };
      },
      ttl: {
        AccessToken: 900, AuthorizationCode: 120, IdToken: 900,
        RefreshToken: 86400 * 14, Session: 86400 * 7, Interaction: 600, Grant: 86400 * 7,
      },
      scopes: ['openid', 'profile', 'email', 'offline_access'],
      claims: {
        openid: ['sub', 'roles'],
        profile: ['name', 'family_name', 'given_name', 'preferred_username', 'updated_at'],
        email: ['email', 'email_verified'],
      },
      conformIdTokenClaims: false,
      rotateRefreshToken: false,
      issueRefreshToken: (_ctx: unknown, client: any) => client.grantTypeAllowed('refresh_token'),
      jwks,
      cookies: {
        keys: cookieKeys,
        long: { httpOnly: true, maxAge: 86400 * 7 * 1000, overwrite: true, sameSite: isProduction ? 'none' as const : 'lax' as const, secure: isProduction, path: '/' },
        short: { httpOnly: true, maxAge: 600 * 1000, overwrite: true, sameSite: isProduction ? 'none' as const : 'lax' as const, secure: isProduction, path: '/' },
      },
      responseTypes: ['code'],
    };

    this.provider = new (Provider as any)(issuer, configuration);
    if (isProduction) { (this.provider as any).proxy = true; }

    this.provider.use(async (ctx: any, next: () => Promise<void>) => {
      await next();
      ctx.remove('X-Frame-Options');
      ctx.set('Content-Security-Policy', `frame-ancestors 'self' ${frontendOrigin}`);
    });

    this.provider.on('server_error', (_ctx: unknown, err: Error) => { this.logger.error('OIDC error:', err); });
    this.logger.log(`OIDC Provider initialized with issuer: ${issuer}`);
  }

  private async getOrCreateJwks(): Promise<{ keys: Record<string, unknown>[] }> {
    const rows = await this.pg.query<{ key_id: string; jwk: Record<string, unknown> }>(
      `SELECT key_id, jwk FROM jwks_keys WHERE active = true ORDER BY created_at DESC`,
    );
    if (rows.length > 0) return { keys: rows.map(r => r.jwk) };

    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    const keyId = crypto.randomUUID();
    const cryptoKey = crypto.createPrivateKey(privateKey);
    const jwk = { ...cryptoKey.export({ format: 'jwk' }), kid: keyId, use: 'sig', alg: 'RS256' };

    await this.pg.query(
      `INSERT INTO jwks_keys (key_id, use, alg, jwk, active) VALUES ($1, 'sig', 'RS256', $2, true)`,
      [keyId, JSON.stringify(jwk)],
    );
    this.logger.log('Generated initial JWKS key');
    return { keys: [jwk] };
  }

  private async getOrCreateCookieKeys(): Promise<string[]> {
    const rows = await this.pg.query<{ value: string }>(
      `SELECT value FROM server_secrets WHERE key = 'cookie-keys'`,
    );
    if (rows[0]) return JSON.parse(rows[0].value) as string[];

    const keys = [crypto.randomBytes(32).toString('hex'), crypto.randomBytes(32).toString('hex')];
    await this.pg.query(`INSERT INTO server_secrets (key, value) VALUES ('cookie-keys', $1)`, [JSON.stringify(keys)]);
    return keys;
  }

  private async syncClientRedirectUris(): Promise<void> {
    const frontendOrigin = this.configService.get<string>('FRONTEND_ORIGIN');
    if (!frontendOrigin) return;
    const serviceName = this.configService.get<string>('SERVICE_NAME', 'service');
    const clientId = `${serviceName}-spa`;
    const expected = [frontendOrigin, `${frontendOrigin}/auth/callback`];
    const expectedLogout = [frontendOrigin];
    await this.pg.query(
      `UPDATE oidc_clients SET redirect_uris = $1, post_logout_redirect_uris = $2 WHERE client_id = $3`,
      [JSON.stringify(expected), JSON.stringify(expectedLogout), clientId],
    );
    this.logger.log(`Synced ${clientId} redirect URIs to ${frontendOrigin}`);
  }

  private async loadClients(): Promise<Record<string, unknown>[]> {
    const rows = await this.pg.query<{
      client_id: string; client_name: string; client_secret: string | null;
      redirect_uris: string[]; post_logout_redirect_uris: string[];
      grant_types: string[]; response_types: string[]; scope: string;
      token_endpoint_auth_method: string; application_type: string;
    }>(`SELECT * FROM oidc_clients WHERE active = true`);
    return rows.map(c => ({
      client_id: c.client_id,
      client_name: c.client_name,
      client_secret: c.client_secret || undefined,
      redirect_uris: c.redirect_uris,
      post_logout_redirect_uris: c.post_logout_redirect_uris,
      grant_types: c.grant_types,
      response_types: c.response_types,
      scope: c.scope,
      token_endpoint_auth_method: c.token_endpoint_auth_method,
      application_type: c.application_type,
    }));
  }
}
```

**Step 6: Create `libs/oidc/src/interactions/otp.service.ts`**

```typescript
// libs/oidc/src/interactions/otp.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';

interface OtpRow {
  id: number;
  email: string;
  code: string;
  expires_at: Date;
  verified_at: Date | null;
  attempts: number;
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private transporter: nodemailer.Transporter;

  constructor(private readonly pg: PgService, private readonly config: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: config.get('SMTP_HOST', 'localhost'),
      port: config.get<number>('SMTP_PORT', 25),
      secure: false,
      tls: { rejectUnauthorized: false },
    });
  }

  async generateAndSend(email: string): Promise<void> {
    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await this.pg.query(
      `INSERT INTO otp_codes (email, code, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET code = $2, expires_at = $3, attempts = 0, verified_at = NULL`,
      [email, code, expiresAt],
    );

    const serviceName = this.config.get('SERVICE_NAME', 'eGuWallet');
    await this.transporter.sendMail({
      from: this.config.get('SMTP_FROM', 'noreply@eguwallet.com'),
      to: email,
      subject: `${serviceName} — Cod de acces`,
      text: `Codul dvs. de acces este: ${code}\nExpiră în 10 minute.`,
      html: `<p>Codul dvs. de acces este: <strong>${code}</strong></p><p>Expiră în 10 minute.</p>`,
    });

    this.logger.log(`OTP sent to ${email}`);
  }

  async verify(email: string, code: string): Promise<boolean> {
    const rows = await this.pg.query<OtpRow>(
      `SELECT * FROM otp_codes WHERE email = $1`,
      [email],
    );
    const otp = rows[0];
    if (!otp || otp.verified_at || otp.expires_at < new Date()) return false;
    if (otp.attempts >= 3) return false;
    if (otp.code !== code) {
      await this.pg.query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE email = $1`, [email]);
      return false;
    }
    await this.pg.query(`UPDATE otp_codes SET verified_at = NOW() WHERE email = $1`, [email]);
    return true;
  }
}
```

**Step 7: Create `libs/oidc/src/interactions/interactions.controller.ts`**

```typescript
// libs/oidc/src/interactions/interactions.controller.ts
import { Controller, Get, Post, Param, Body, Req, Res, BadRequestException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OidcService } from '../oidc.service';
import { OtpService } from './otp.service';
import { UsersService } from '../users/users.service';

interface InteractionDetails {
  prompt: { name: string };
  params: Record<string, unknown>;
  session?: { accountId: string };
}

@Controller('interactions')
export class InteractionsController {
  constructor(
    private readonly oidcService: OidcService,
    private readonly otpService: OtpService,
    private readonly usersService: UsersService,
  ) {}

  @Get(':uid')
  async getInteraction(@Param('uid') uid: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const details = await this.oidcService.interactionDetails(req, res) as InteractionDetails;
    if (details.prompt.name === 'login') {
      res.json({ uid, prompt: 'login' });
    } else if (details.prompt.name === 'consent') {
      // Auto-approve consent for first-party apps
      await this.oidcService.interactionFinished(req, res, { consent: { rejectedScopes: [], rejectedClaims: [] } });
    } else {
      res.status(400).json({ error: 'Unknown prompt' });
    }
  }

  @Post(':uid/login/send-otp')
  async sendOtp(@Param('uid') _uid: string, @Body() body: { email: string }): Promise<{ ok: boolean }> {
    if (!body.email) throw new BadRequestException('email required');
    await this.otpService.generateAndSend(body.email);
    return { ok: true };
  }

  @Post(':uid/login/verify-otp')
  async verifyOtp(
    @Param('uid') uid: string,
    @Body() body: { email: string; code: string },
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    if (!body.email || !body.code) throw new BadRequestException('email and code required');
    const valid = await this.otpService.verify(body.email, body.code);
    if (!valid) throw new BadRequestException('Invalid or expired OTP');

    const user = await this.usersService.findByEmail(body.email);
    if (!user) throw new BadRequestException('User not found or inactive');

    await this.oidcService.interactionFinished(req, res, {
      login: { accountId: String(user.id), acr: 'urn:eidas:loa:low' },
    });
  }
}
```

**Step 8: Create `libs/oidc/src/users/users.service.ts`**

```typescript
// libs/oidc/src/users/users.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';

interface UserRow {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  roles: string[];
  active: boolean;
  updated_at: Date;
}

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly pg: PgService, private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultAdmin();
  }

  async findByEmail(email: string): Promise<UserRow | null> {
    const rows = await this.pg.query<UserRow>(`SELECT * FROM users WHERE email = $1 AND active = true`, [email]);
    return rows[0] ?? null;
  }

  private async seedDefaultAdmin(): Promise<void> {
    const adminEmail = 'thomas@eguilde.cloud';
    const serviceName = this.config.get<string>('SERVICE_NAME', 'service').toUpperCase();
    const adminRole = `${serviceName}_ADMIN`;

    const existing = await this.pg.query<{ id: number }>(
      `SELECT id FROM users WHERE email = $1`, [adminEmail],
    );

    if (existing.length === 0) {
      await this.pg.query(
        `INSERT INTO users (email, first_name, last_name, roles, active)
         VALUES ($1, 'Thomas', 'Galambos', $2, true)`,
        [adminEmail, JSON.stringify([adminRole])],
      );
      this.logger.log(`Seeded default admin: ${adminEmail} with role ${adminRole}`);
    } else {
      // Ensure admin role is present
      const user = existing[0];
      const rolesRows = await this.pg.query<{ roles: string[] }>(`SELECT roles FROM users WHERE id = $1`, [user.id]);
      const roles: string[] = rolesRows[0]?.roles ?? [];
      if (!roles.includes(adminRole)) {
        roles.push(adminRole);
        await this.pg.query(`UPDATE users SET roles = $1 WHERE id = $2`, [JSON.stringify(roles), user.id]);
        this.logger.log(`Added role ${adminRole} to ${adminEmail}`);
      }
    }
  }
}
```

**Step 9: Create `libs/oidc/src/auth/auth.controller.ts`**

BFF token exchange — Angular SPA posts PKCE code, backend exchanges with OIDC provider:

```typescript
// libs/oidc/src/auth/auth.controller.ts
import { Controller, Post, Body, Headers, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { Request } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly config: ConfigService) {}

  @Post('token')
  async exchangeToken(
    @Body() body: { code: string; code_verifier: string; redirect_uri: string },
    @Headers('dpop') dpop: string | undefined,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    const port = this.config.get<number>('PORT', 3003);
    const internalOidcUrl = `http://localhost:${port}/oidc`;
    const serviceName = this.config.get<string>('SERVICE_NAME', 'service');

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: `${serviceName}-spa`,
      code: body.code,
      code_verifier: body.code_verifier,
      redirect_uri: body.redirect_uri,
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (dpop) headers['DPoP'] = dpop;

    const response = await axios.post<Record<string, unknown>>(
      `${internalOidcUrl}/token`,
      params.toString(),
      { headers },
    );
    return response.data;
  }

  @Post('refresh')
  async refreshToken(
    @Body() body: { refresh_token: string },
    @Headers('dpop') dpop: string | undefined,
  ): Promise<Record<string, unknown>> {
    const port = this.config.get<number>('PORT', 3003);
    const serviceName = this.config.get<string>('SERVICE_NAME', 'service');

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: `${serviceName}-spa`,
      refresh_token: body.refresh_token,
    });

    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (dpop) headers['DPoP'] = dpop;

    const response = await axios.post<Record<string, unknown>>(
      `http://localhost:${port}/oidc/token`,
      params.toString(),
      { headers },
    );
    return response.data;
  }
}
```

**Step 10: Create `libs/oidc/src/oidc.module.ts`**

```typescript
// libs/oidc/src/oidc.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PgModule } from '@app/database';
import { OidcService } from './oidc.service';
import { OidcController } from './oidc.controller';
import { InteractionsController } from './interactions/interactions.controller';
import { OtpService } from './interactions/otp.service';
import { UsersService } from './users/users.service';
import { AuthController } from './auth/auth.controller';

@Module({
  imports: [ConfigModule, PgModule],
  controllers: [OidcController, InteractionsController, AuthController],
  providers: [OidcService, OtpService, UsersService],
  exports: [OidcService, UsersService],
})
export class OidcModule {}
```

**Step 11: Create `libs/oidc/src/oidc.controller.ts`**

Forwards all `/oidc/*` requests to the oidc-provider Koa app:

```typescript
// libs/oidc/src/oidc.controller.ts
import { All, Controller, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OidcService } from './oidc.service';

@Controller('oidc')
export class OidcController {
  constructor(private readonly oidcService: OidcService) {}

  @All('*')
  callback(@Req() req: Request, @Res() res: Response): void {
    const provider = this.oidcService.getProvider();
    (provider as any).callback()(req, res);
  }
}
```

**Step 12: Create `libs/oidc/src/index.ts`**

```typescript
export { OidcModule } from './oidc.module';
export { OidcService } from './oidc.service';
export { UsersService } from './users/users.service';
```

**Step 13: Write failing test for OtpService**

Create `libs/oidc/src/interactions/otp.service.spec.ts`:

```typescript
import { Test } from '@nestjs/testing';
import { OtpService } from './otp.service';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';

describe('OtpService', () => {
  let service: OtpService;
  let pg: { query: jest.Mock };

  beforeEach(async () => {
    pg = { query: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        OtpService,
        { provide: PgService, useValue: pg },
        { provide: ConfigService, useValue: { get: (k: string, d: unknown) => d } },
      ],
    }).compile();
    service = module.get(OtpService);
  });

  describe('verify', () => {
    it('returns false when no OTP exists', async () => {
      pg.query.mockResolvedValue([]);
      expect(await service.verify('a@b.com', '123456')).toBe(false);
    });

    it('returns false when OTP is expired', async () => {
      pg.query.mockResolvedValue([{
        code: '123456',
        expires_at: new Date(Date.now() - 1000),
        verified_at: null,
        attempts: 0,
      }]);
      expect(await service.verify('a@b.com', '123456')).toBe(false);
    });

    it('returns true for valid OTP', async () => {
      pg.query
        .mockResolvedValueOnce([{ code: '123456', expires_at: new Date(Date.now() + 60000), verified_at: null, attempts: 0 }])
        .mockResolvedValueOnce([]);
      expect(await service.verify('a@b.com', '123456')).toBe(true);
    });
  });
});
```

**Step 14: Run the test**

```bash
cd C:\dev\eguilde_wallet\monoback
bun run test libs/oidc/src/interactions/otp.service.spec.ts
# Expected: PASS (or FAIL with import errors — fix lib path issues first)
```

**Step 15: Commit**

```bash
cd C:\dev\eguilde_wallet\monoback
git add libs/oidc/ nest-cli.json tsconfig.json package.json bun.lock
git commit -m "feat(oidc): add shared @app/oidc library with oidc-provider v9, OTP, users"
```

---

### Task 5: Create shared OIDC database migration

**Context:** Each service gets its own database. The migration creates the same tables in each. Applied per-service before first deployment.

**Files to create:**
- `libs/database/src/schemas/100-service-oidc-base.sql`

**Step 1: Create the migration file**

```sql
-- libs/database/src/schemas/100-service-oidc-base.sql
-- Per-service OIDC base tables
-- Applied to: eguwallet_qtsp, eguwallet_lotl, eguwallet_cert, eguwallet_wallet, eguwallet_dgp
-- Run: psql -U postgres -d eguwallet_<service> -f 100-service-oidc-base.sql

-- Users table (admin/inspector only)
CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR NOT NULL UNIQUE,
    first_name  VARCHAR,
    last_name   VARCHAR,
    roles       JSONB NOT NULL DEFAULT '[]',
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OIDC sessions/tokens/codes (oidc-provider adapter)
CREATE TABLE IF NOT EXISTS oidc_models (
    model_id    VARCHAR NOT NULL,
    model_name  VARCHAR NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    grant_id    VARCHAR,
    user_code   VARCHAR,
    uid         VARCHAR,
    expires_at  TIMESTAMPTZ,
    consumed_at TIMESTAMPTZ,
    PRIMARY KEY (model_id, model_name)
);

CREATE INDEX IF NOT EXISTS oidc_models_uid_idx ON oidc_models (uid, model_name);
CREATE INDEX IF NOT EXISTS oidc_models_grant_id_idx ON oidc_models (grant_id);
CREATE INDEX IF NOT EXISTS oidc_models_user_code_idx ON oidc_models (user_code);
CREATE INDEX IF NOT EXISTS oidc_models_expires_at_idx ON oidc_models (expires_at) WHERE expires_at IS NOT NULL;

-- OIDC registered clients
CREATE TABLE IF NOT EXISTS oidc_clients (
    id                          SERIAL PRIMARY KEY,
    client_id                   VARCHAR NOT NULL UNIQUE,
    client_name                 VARCHAR NOT NULL,
    client_secret               VARCHAR,
    redirect_uris               JSONB NOT NULL DEFAULT '[]',
    post_logout_redirect_uris   JSONB NOT NULL DEFAULT '[]',
    grant_types                 JSONB NOT NULL DEFAULT '[]',
    response_types              JSONB NOT NULL DEFAULT '[]',
    scope                       VARCHAR NOT NULL DEFAULT 'openid profile email offline_access',
    token_endpoint_auth_method  VARCHAR NOT NULL DEFAULT 'none',
    application_type            VARCHAR NOT NULL DEFAULT 'web',
    active                      BOOLEAN NOT NULL DEFAULT true,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- JWKS signing keys
CREATE TABLE IF NOT EXISTS jwks_keys (
    id          SERIAL PRIMARY KEY,
    key_id      VARCHAR NOT NULL UNIQUE,
    use         VARCHAR NOT NULL DEFAULT 'sig',
    alg         VARCHAR NOT NULL DEFAULT 'RS256',
    jwk         JSONB NOT NULL,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Server secrets (cookie keys, etc.)
CREATE TABLE IF NOT EXISTS server_secrets (
    key         VARCHAR NOT NULL PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- OTP codes for login
CREATE TABLE IF NOT EXISTS otp_codes (
    email       VARCHAR NOT NULL PRIMARY KEY,
    code        VARCHAR NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ,
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Step 2: Apply migration to create all service databases**

SSH to egucluster3 or run against egucluster4:

```bash
# Create databases first
psql -U postgres -h egucluster4.eguilde.cloud -c "CREATE DATABASE eguwallet_qtsp;"
psql -U postgres -h egucluster4.eguilde.cloud -c "CREATE DATABASE eguwallet_lotl;"
psql -U postgres -h egucluster4.eguilde.cloud -c "CREATE DATABASE eguwallet_cert;"
psql -U postgres -h egucluster4.eguilde.cloud -c "CREATE DATABASE eguwallet_wallet;"
psql -U postgres -h egucluster4.eguilde.cloud -c "CREATE DATABASE eguwallet_dgp;"

# Apply OIDC base migration to each
for db in eguwallet_qtsp eguwallet_lotl eguwallet_cert eguwallet_wallet eguwallet_dgp; do
  psql -U postgres -h egucluster4.eguilde.cloud -d $db -f libs/database/src/schemas/100-service-oidc-base.sql
  echo "Applied to $db"
done
```

**Step 3: Seed OIDC client and service-specific domain tables**

Create `libs/database/src/schemas/101-seed-oidc-clients.sql`:

```sql
-- 101-seed-oidc-clients.sql
-- Run once per service with SERVICE_NAME set
-- Example: psql ... -v service_name=qtsp -f 101-seed-oidc-clients.sql

INSERT INTO oidc_clients (
    client_id, client_name, redirect_uris, post_logout_redirect_uris,
    grant_types, response_types, scope, token_endpoint_auth_method, application_type
) VALUES (
    :'service_name' || '-spa',
    :'service_name' || ' Admin Panel',
    ('["https://' || :'service_name' || '.eguwallet.com", "https://' || :'service_name' || '.eguwallet.com/auth/callback", "http://localhost:4200", "http://localhost:4200/auth/callback"]')::jsonb,
    ('["https://' || :'service_name' || '.eguwallet.com", "http://localhost:4200"]')::jsonb,
    '["authorization_code", "refresh_token"]'::jsonb,
    '["code"]'::jsonb,
    'openid profile email offline_access',
    'none',
    'web'
) ON CONFLICT (client_id) DO UPDATE SET
    redirect_uris = EXCLUDED.redirect_uris,
    post_logout_redirect_uris = EXCLUDED.post_logout_redirect_uris;
```

Apply:
```bash
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_qtsp -v service_name=qtsp -f libs/database/src/schemas/101-seed-oidc-clients.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_lotl -v service_name=lotl -f libs/database/src/schemas/101-seed-oidc-clients.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_cert -v service_name=cert -f libs/database/src/schemas/101-seed-oidc-clients.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_wallet -v service_name=wallet -f libs/database/src/schemas/101-seed-oidc-clients.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_dgp -v service_name=dgp -f libs/database/src/schemas/101-seed-oidc-clients.sql
```

**Step 4: Also apply each service's existing domain schema to its new DB**

For each service, run its existing schema migration against the new dedicated DB. Example for qtsp:
```bash
# qtsp domain tables currently in eguwallet DB — apply schema 005-qtsp.sql to eguwallet_qtsp
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_qtsp -f libs/database/src/schemas/001-common.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_qtsp -f libs/database/src/schemas/002-audit.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_qtsp -f libs/database/src/schemas/005-qtsp.sql
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_qtsp -f libs/database/src/schemas/100-service-oidc-base.sql
```

Repeat for each service with their respective domain schema (005→qtsp, 006→lotl, 007→cert, 004→wallet, 009→dgp).

**Step 5: Commit**

```bash
git add libs/database/src/schemas/100-service-oidc-base.sql libs/database/src/schemas/101-seed-oidc-clients.sql
git commit -m "feat(db): add per-service OIDC base migration and client seed"
```

---

## Phase 2: Angular Frontends Workspace

### Task 6: Bootstrap Angular frontends workspace

**Context:** Create `C:\dev\eguilde_wallet\monoback\frontends\` as an Angular workspace with 5 projects. Built Angular dist is served by each NestJS service as static files.

**Files to create:**
- `frontends/package.json`
- `frontends/angular.json` (5 projects: qtsp, lotl, cert, wallet, dgp)
- `frontends/tsconfig.json`
- `frontends/projects/qtsp/` (and lotl, cert, wallet, dgp)

**Step 1: Create the Angular workspace**

```bash
cd C:\dev\eguilde_wallet\monoback\frontends
npx @angular/cli@21 new frontends --no-create-application --skip-git --package-manager=npm
cd frontends
```

**Step 2: Create the 5 Angular projects**

```bash
# Run for each service
ng generate application qtsp --routing=true --style=none --ssr=false
ng generate application lotl --routing=true --style=none --ssr=false
ng generate application cert --routing=true --style=none --ssr=false
ng generate application wallet --routing=true --style=none --ssr=false
ng generate application dgp --routing=true --style=none --ssr=false
```

**Step 3: Install shared dependencies**

```bash
npm install primeng@latest primeicons tailwindcss @tailwindcss/vite
npm install @transloco/core
```

**Step 4: Create shared auth service pattern**

Create `frontends/src/app/core/auth.service.ts` (shared across all apps via library or copy):

```typescript
// Pattern used in each app — inline per project for simplicity

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private isLoggedIn$ = new BehaviorSubject<boolean>(this.hasTokens());

  get isAuthenticated() { return this.isLoggedIn$.asObservable(); }
  get accessToken() { return localStorage.getItem('access_token'); }

  // Kick off PKCE Authorization Code flow
  async login(): Promise<void> {
    const verifier = this.randomBase64(32);
    const challenge = await this.pkceChallenge(verifier);
    localStorage.setItem('pkce_verifier', verifier);
    localStorage.setItem('pkce_state', this.randomBase64(16));

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.getClientId(),
      redirect_uri: this.getRedirectUri(),
      scope: 'openid profile email offline_access',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: localStorage.getItem('pkce_state')!,
    });

    window.location.href = `/oidc/auth?${params}`;
  }

  async handleCallback(code: string): Promise<void> {
    const verifier = localStorage.getItem('pkce_verifier')!;
    const res = await this.http.post<{ access_token: string; refresh_token: string; id_token: string }>(
      '/api/auth/token',
      { code, code_verifier: verifier, redirect_uri: this.getRedirectUri() },
    ).toPromise();
    if (res) {
      localStorage.setItem('access_token', res.access_token);
      localStorage.setItem('refresh_token', res.refresh_token);
      localStorage.setItem('id_token', res.id_token);
      localStorage.removeItem('pkce_verifier');
      this.isLoggedIn$.next(true);
    }
    await this.router.navigateByUrl('/admin');
  }

  logout(): void {
    localStorage.clear();
    this.isLoggedIn$.next(false);
    window.location.href = `/oidc/session/end?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
  }

  private hasTokens(): boolean { return !!localStorage.getItem('access_token'); }
  private getClientId(): string { return document.location.hostname.split('.')[0] + '-spa'; }
  private getRedirectUri(): string { return `${window.location.origin}/auth/callback`; }

  private randomBase64(len: number): string {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  private async pkceChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const arr = Array.from(new Uint8Array(digest));
    return btoa(String.fromCharCode(...arr)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }
}
```

**Step 5: Create qtsp Angular app — Login component**

Create `frontends/projects/qtsp/src/app/login/login.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';
import { CardModule } from 'primeng/card';
import { MessageModule } from 'primeng/message';
import { HttpClient } from '@angular/common/http';
import { Router, ActivatedRoute } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule, ButtonModule, InputTextModule, CardModule, MessageModule],
  template: `
    <div class="flex items-center justify-center h-screen">
      <p-card class="w-full md:w-96">
        <ng-template pTemplate="header">
          <div class="flex flex-col items-center p-4">
            <h1 class="text-2xl font-bold">QTSP Admin</h1>
            <p class="text-sm">Qualified Trust Service Provider</p>
          </div>
        </ng-template>

        <div class="flex flex-col gap-4">
          @if (!otpSent) {
            <div class="flex flex-col gap-2">
              <label for="email">Adresa de email</label>
              <input pInputText id="email" [(ngModel)]="email" type="email" placeholder="admin@example.com" class="w-full" />
            </div>
            <p-button label="Trimite cod" (onClick)="sendOtp()" [loading]="loading" class="w-full" />
          } @else {
            <div class="flex flex-col gap-2">
              <label for="code">Cod de verificare</label>
              <input pInputText id="code" [(ngModel)]="code" type="text" placeholder="123456" class="w-full" maxlength="6" />
            </div>
            <p-button label="Verifică" (onClick)="verifyOtp()" [loading]="loading" class="w-full" />
            <p-button label="Retrimite cod" (onClick)="sendOtp()" [link]="true" class="w-full" />
          }
          @if (error) {
            <p-message severity="error" [text]="error" />
          }
        </div>
      </p-card>
    </div>
  `,
})
export class LoginComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly auth = inject(AuthService);

  email = '';
  code = '';
  uid = '';
  otpSent = false;
  loading = false;
  error = '';

  ngOnInit(): void {
    this.uid = this.route.snapshot.queryParams['uid'] ?? '';
    const callbackCode = this.route.snapshot.queryParams['code'];
    if (callbackCode) { this.auth.handleCallback(callbackCode); }
  }

  async sendOtp(): Promise<void> {
    this.loading = true; this.error = '';
    try {
      await this.http.post(`/interactions/${this.uid}/login/send-otp`, { email: this.email }).toPromise();
      this.otpSent = true;
    } catch { this.error = 'Nu s-a putut trimite codul. Verificați adresa de email.'; }
    finally { this.loading = false; }
  }

  async verifyOtp(): Promise<void> {
    this.loading = true; this.error = '';
    try {
      await this.http.post(`/interactions/${this.uid}/login/verify-otp`, { email: this.email, code: this.code }).toPromise();
      // OIDC provider redirects automatically after interactionFinished
    } catch { this.error = 'Cod invalid sau expirat.'; }
    finally { this.loading = false; }
  }
}
```

**Step 6: Create qtsp Admin dashboard component (skeleton)**

Create `frontends/projects/qtsp/src/app/admin/admin.component.ts`:

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { ButtonModule } from 'primeng/button';
import { TableModule } from 'primeng/table';
import { TabViewModule } from 'primeng/tabview';
import { CardModule } from 'primeng/card';
import { HttpClient } from '@angular/common/http';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, RouterModule, ButtonModule, TableModule, TabViewModule, CardModule],
  template: `
    <div class="flex flex-col h-screen">
      <!-- Navbar -->
      <div class="flex items-center justify-between p-4">
        <h1 class="text-xl font-bold">QTSP — Panou de administrare</h1>
        <p-button label="Deconectare" severity="secondary" (onClick)="auth.logout()" />
      </div>

      <!-- Content -->
      <div class="flex-1 overflow-auto p-4">
        <p-tabView>
          <p-tabPanel header="Certificate">
            <p-table [value]="certificates" [loading]="loading">
              <ng-template pTemplate="header">
                <tr>
                  <th>Serial</th><th>Subiect</th><th>Tip</th><th>Expiră</th><th>Status</th>
                </tr>
              </ng-template>
              <ng-template pTemplate="body" let-cert>
                <tr>
                  <td>{{ cert.serial_number }}</td>
                  <td>{{ cert.subject_cn }}</td>
                  <td>{{ cert.certificate_type }}</td>
                  <td>{{ cert.expires_at | date:'short' }}</td>
                  <td>{{ cert.status }}</td>
                </tr>
              </ng-template>
            </p-table>
          </p-tabPanel>

          <p-tabPanel header="OCSP / CRL">
            <p-card header="Status servicii RFC">
              <div class="flex flex-col gap-2">
                <a href="/ocsp" target="_blank" class="flex items-center gap-2">
                  <span class="font-mono">GET /ocsp</span>
                  <span>RFC 6960 OCSP Responder</span>
                </a>
                <a href="/crl" target="_blank" class="flex items-center gap-2">
                  <span class="font-mono">GET /crl</span>
                  <span>RFC 5280 CRL</span>
                </a>
                <a href="/tsa" target="_blank" class="flex items-center gap-2">
                  <span class="font-mono">POST /tsa</span>
                  <span>RFC 3161 TSA</span>
                </a>
              </div>
            </p-card>
          </p-tabPanel>
        </p-tabView>
      </div>
    </div>
  `,
})
export class AdminComponent implements OnInit {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  certificates: unknown[] = [];
  loading = true;

  ngOnInit(): void {
    this.http.get<unknown[]>('/api/qtsp/certificates', {
      headers: { Authorization: `Bearer ${this.auth.accessToken}` },
    }).subscribe({ next: data => { this.certificates = data; this.loading = false; }, error: () => { this.loading = false; } });
  }
}
```

**Step 7: Configure routes and app.config.ts for qtsp**

Update `frontends/projects/qtsp/src/app/app.routes.ts`:

```typescript
import { Routes } from '@angular/router';
import { AuthGuard } from './core/auth.guard';

export const routes: Routes = [
  { path: 'auth/callback', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  { path: 'login', loadComponent: () => import('./login/login.component').then(m => m.LoginComponent) },
  { path: 'admin', loadComponent: () => import('./admin/admin.component').then(m => m.AdminComponent), canActivate: [AuthGuard] },
  { path: 'inspector', loadComponent: () => import('./inspector/inspector.component').then(m => m.InspectorComponent), canActivate: [AuthGuard] },
  { path: '', redirectTo: 'admin', pathMatch: 'full' },
];
```

**Step 8: Build qtsp frontend**

```bash
cd frontends
npm run build -- --project=qtsp
# Expected: dist/qtsp/ created with index.html and assets
```

**Step 9: Repeat steps 5-8 for lotl, cert, wallet, dgp**

Same pattern for each app. Change:
- Component title: "LOTL — Trusted Lists", "Certification — CAB", "Wallet Provider", "DGP — Pașapoarte"
- Admin tabs: lotl (Trust Lists, EU Sync, XML Export), cert (Assessments, Audits), wallet (Instances, Attestations), dgp (Credentials, Requests)
- API endpoints: `/api/lotl/*`, `/api/certification/*`, `/api/wallet/*`, `/api/dgp/*`

**Step 10: Commit**

```bash
cd C:\dev\eguilde_wallet\monoback
git add frontends/
git commit -m "feat(frontend): add Angular 21 + PrimeNG admin frontends for all services"
```

---

## Phase 3: QTSP Service Integration

### Task 7: Add OIDC to QTSP NestJS app

**Context:** `apps/qtsp/` — needs OidcModule added, main.ts updated to serve Angular static files.

**Files to modify:**
- `apps/qtsp/src/app.module.ts`
- `apps/qtsp/src/main.ts`

**Files to create:**
- `apps/qtsp/.env.example`

**Step 1: Update `apps/qtsp/src/app.module.ts`**

Add `OidcModule` import and remove `MessagingModule` (replaced by HTTP in Phase 7):

```typescript
import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PgModule } from '@app/database';
import { AuditModule } from '@app/audit';
import { ComplianceModule } from '@app/compliance';
import { OidcModule } from '@app/oidc';    // NEW

import { ConformityAssessmentModule } from './conformity-assessment/conformity-assessment.module';
import { QtspController } from './controllers/qtsp.controller';
import { RfcEndpointsController } from './controllers/rfc-endpoints.controller';
import { QtspCAService } from './services/qtsp-ca.service';
import { QtspService } from './services/qtsp.service';
import { IssuedCertificateService } from './services/issued-certificate.service';
import { OcspService } from './services/ocsp.service';
import { CrlService } from './services/crl.service';
import { TslService } from './services/tsl.service';
import { PolicyService } from './services/policy.service';
import { Rfc6960OcspService } from './services/rfc6960-ocsp.service';
import { Rfc5280CrlService } from './services/rfc5280-crl.service';
import { Rfc3161TsaService } from './services/rfc3161-tsa.service';
import { QesCertificateService } from './services/qes-certificate.service';
import { QsealCertificateService } from './services/qseal-certificate.service';
import { QwacCertificateService } from './services/qwac-certificate.service';
import { QedsCertificateService } from './services/qeds-certificate.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: 'apps/qtsp/.env' }),
    PgModule,
    AuditModule,
    ComplianceModule,
    ConformityAssessmentModule,
    OidcModule,       // NEW — adds OIDC provider, interactions, auth endpoints
  ],
  controllers: [QtspController, RfcEndpointsController],
  providers: [
    QtspCAService, QtspService, IssuedCertificateService,
    OcspService, CrlService, TslService, PolicyService,
    Rfc6960OcspService, Rfc5280CrlService, Rfc3161TsaService,
    QesCertificateService, QsealCertificateService, QwacCertificateService, QedsCertificateService,
  ],
})
export class AppModule implements OnModuleInit {
  private readonly logger = new Logger(AppModule.name);
  constructor(private readonly qtspCAService: QtspCAService) {}

  async onModuleInit() {
    this.logger.log('Initializing QTSP CA hierarchy...');
    await this.qtspCAService.initialize();
    this.logger.log('QTSP CA hierarchy initialized');
  }
}
```

**Step 2: Update `apps/qtsp/src/main.ts` to serve Angular static files**

```typescript
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as path from 'path';
import * as express from 'express';

async function bootstrap() {
  const logger = new Logger('QtspService');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const port = process.env.PORT || 3003;

  // Trust nginx proxy (X-Forwarded-For, X-Forwarded-Proto)
  app.set('trust proxy', 1);

  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN || 'http://localhost:4200',
    credentials: true,
  });

  // Serve Angular frontend as static files
  const frontendDist = path.join(__dirname, '..', 'frontend-dist');
  app.use(express.static(frontendDist));

  // All routes not matched by NestJS → return Angular's index.html
  // This enables Angular router to handle deep links (e.g. /admin, /inspector)
  // NOTE: OIDC + API routes must be registered BEFORE this catch-all
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.path.startsWith('/oidc') || req.path.startsWith('/api') || req.path.startsWith('/interactions')) {
      return next();
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  await app.listen(port);
  logger.log(`QTSP service listening on port ${port}`);
  logger.log(`OIDC Issuer: ${process.env.OIDC_ISSUER}`);
}

bootstrap();
```

**Step 3: Create `.env.example` for QTSP**

Create `apps/qtsp/.env.example`:

```bash
# apps/qtsp/.env.example
NODE_ENV=production
SERVICE_NAME=qtsp
PORT=3003

# Database (dedicated qtsp DB)
DB_HOST=egucluster4.eguilde.cloud
DB_PORT=5432
DB_NAME=eguwallet_qtsp
DB_USER=postgres
DB_PASSWORD=YOUR_PG_PASSWORD

# OIDC
OIDC_ISSUER=https://qtsp.eguwallet.com/oidc
API_RESOURCE=https://qtsp.eguwallet.com/api
FRONTEND_ORIGIN=https://qtsp.eguwallet.com

# Email (OTP delivery)
SMTP_HOST=localhost
SMTP_PORT=25
SMTP_FROM=noreply@eguwallet.com

# Internal mTLS (Phase 7)
MTLS_ENABLED=false
MTLS_PORT=3103
```

Create actual `apps/qtsp/.env` from this example with real values (do not commit).

**Step 4: Update PgModule to use per-service DB env vars**

Check how `@app/database` PgModule reads config. If it currently uses the single shared `DB_*` vars, ensure each service's `.env` overrides them for the dedicated DB. The PgModule should read `DB_NAME` (or `DB_DATABASE`) from env. If it uses a hardcoded database name, trace to `libs/database/src/pg.service.ts` and confirm it reads `DB_NAME` from config.

**Step 5: Build qtsp**

```bash
cd C:\dev\eguilde_wallet\monoback
bun run build qtsp
# Expected: dist/apps/qtsp/ created
```

**Step 6: Verify OIDC endpoints exist in qtsp build**

```bash
# Run locally briefly to check
PORT=3003 OIDC_ISSUER=http://localhost:3003/oidc NODE_ENV=development bun run dist/apps/qtsp/main.js &
sleep 3
curl http://localhost:3003/oidc/.well-known/openid-configuration | head -5
# Expected: JSON with issuer, authorization_endpoint, token_endpoint, etc.
kill %1
```

**Step 7: Commit**

```bash
git add apps/qtsp/src/ apps/qtsp/.env.example
git commit -m "feat(qtsp): add OIDC provider, OTP login, static Angular serving"
```

---

### Task 8: QTSP Dockerfile update for Angular frontend

**Files to modify:**
- `apps/qtsp/Dockerfile`

**Step 1: Update Dockerfile to multi-stage with Angular build**

```dockerfile
# apps/qtsp/Dockerfile

# Stage 1: Build Angular frontend
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontends
COPY frontends/package*.json ./
RUN npm ci
COPY frontends/ .
RUN npm run build -- --project=qtsp --configuration=production

# Stage 2: Build NestJS (bun)
FROM oven/bun:1 AS backend-builder
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build qtsp

# Stage 3: Production image
FROM oven/bun:1-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3003

RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nodejs

# NestJS dist
COPY --from=backend-builder --chown=nodejs:nodejs /app/dist/apps/qtsp ./dist
COPY --from=backend-builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=backend-builder --chown=nodejs:nodejs /app/package.json ./

# Angular dist (served as static files)
COPY --from=frontend-builder --chown=nodejs:nodejs /app/frontends/dist/qtsp ./dist/frontend-dist

USER nodejs

EXPOSE 3003

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3003/health || exit 1

CMD ["bun", "run", "dist/main.js"]
```

**Step 2: Add `/health` endpoint to qtsp**

Add to `apps/qtsp/src/controllers/qtsp.controller.ts` (or create a dedicated health controller):

```typescript
@Get('health')
@Public()  // no auth required
health(): { status: string; service: string } {
  return { status: 'ok', service: 'qtsp' };
}
```

**Step 3: Build and test Docker image locally**

```bash
cd C:\dev\eguilde_wallet\monoback
docker build -f apps/qtsp/Dockerfile -t qtsp-test .
docker run --rm -p 3003:3003 --env-file apps/qtsp/.env qtsp-test &
sleep 10
curl http://localhost:3003/health
# Expected: {"status":"ok","service":"qtsp"}
curl http://localhost:3003/oidc/.well-known/openid-configuration | python -m json.tool | head -10
docker stop $(docker ps -q --filter ancestor=qtsp-test)
```

**Step 4: Commit**

```bash
git add apps/qtsp/Dockerfile
git commit -m "feat(qtsp): multi-stage Dockerfile with Angular frontend build"
```

---

### Task 9: QTSP docker-compose and deploy to egucluster3

**Files to create:**
- `apps/qtsp/docker-compose.yml`

**Step 1: Create `apps/qtsp/docker-compose.yml`**

```yaml
# apps/qtsp/docker-compose.yml
# Standalone deploy: copy this file + .env.production to target server
# Run: docker compose -f docker-compose.yml up -d

services:
  qtsp:
    build:
      context: ../..
      dockerfile: apps/qtsp/Dockerfile
    image: ghcr.io/eguilde/eguilde_wallet/qtsp:latest
    env_file: .env.production
    environment:
      SERVICE_NAME: qtsp
      PORT: "3003"
    ports:
      - "0.0.0.0:3003:3003"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3003/health"]
      interval: 30s
      timeout: 10s
      start_period: 60s
      retries: 3
```

**Step 2: Build and push Docker image**

```bash
# Build image
docker build -f apps/qtsp/Dockerfile -t ghcr.io/eguilde/eguilde_wallet/qtsp:latest .

# Login to GHCR
echo $GITHUB_TOKEN | docker login ghcr.io -u eguilde --password-stdin

# Push
docker push ghcr.io/eguilde/eguilde_wallet/qtsp:latest
```

**Step 3: Deploy to egucluster3**

```bash
ssh eguilde@egucluster3.eguilde.cloud
mkdir -p ~/eguwallet-qtsp
# Copy docker-compose.yml and .env.production to server
scp apps/qtsp/docker-compose.yml eguilde@egucluster3.eguilde.cloud:~/eguwallet-qtsp/
scp apps/qtsp/.env.production eguilde@egucluster3.eguilde.cloud:~/eguwallet-qtsp/

# On egucluster3:
cd ~/eguwallet-qtsp
docker compose pull
docker compose up -d
docker compose logs -f qtsp
```

**Step 4: Verify live deployment**

```bash
# From local machine:
curl https://qtsp.eguwallet.com/health
# Expected: {"status":"ok","service":"qtsp"}

curl https://qtsp.eguwallet.com/oidc/.well-known/openid-configuration | python -m json.tool | grep issuer
# Expected: "issuer": "https://qtsp.eguwallet.com/oidc"
```

**Step 5: Test QTSP admin frontend**

Open browser: `https://qtsp.eguwallet.com`
- Should redirect to login page
- Enter `thomas@eguilde.cloud` → receive OTP email → verify → land on admin dashboard

**Step 6: Verify RFC public endpoints still work**

```bash
curl https://qtsp.eguwallet.com/ocsp
curl https://qtsp.eguwallet.com/crl
# Expected: appropriate RFC responses (not 401)
```

**Step 7: Commit**

```bash
git add apps/qtsp/docker-compose.yml
git commit -m "feat(qtsp): add standalone docker-compose for qtsp.eguwallet.com"
```

---

## Phase 4: LOTL Service

### Task 10: Add OIDC + frontend + deploy for LOTL

**Pattern:** Same as Task 7-9 for QTSP. Apply these changes:

**Files to modify:**
- `apps/lotl/src/app.module.ts` — add `OidcModule`, remove `MessagingModule`
- `apps/lotl/src/main.ts` — same pattern as qtsp main.ts with `SERVICE_NAME=lotl`, `PORT=3002`

**Files to create:**
- `apps/lotl/.env.example` — same as qtsp but `SERVICE_NAME=lotl`, `PORT=3002`, `DB_NAME=eguwallet_lotl`, `OIDC_ISSUER=https://lotl.eguwallet.com/oidc`
- `apps/lotl/docker-compose.yml` — same as qtsp but port 3002, service name lotl
- `apps/lotl/Dockerfile` — same as qtsp Dockerfile but `--project=lotl` and port 3002

**Public endpoints to verify (mark with `@Public()` in LOTL):**
- `GET /lotl.xml` — signed trust list (no auth required)
- `GET /api/lotl` — trust list JSON (no auth required)

**Database:** `eguwallet_lotl` — apply 001-common.sql, 002-audit.sql, 006-lotl.sql, 100-service-oidc-base.sql

**Verify live:**
```bash
curl https://lotl.eguwallet.com/health
curl https://lotl.eguwallet.com/lotl.xml | head -5
curl https://lotl.eguwallet.com/oidc/.well-known/openid-configuration | python -m json.tool | grep issuer
# Expected: "issuer": "https://lotl.eguwallet.com/oidc"
```

**Commit:**
```bash
git add apps/lotl/
git commit -m "feat(lotl): add OIDC, Angular frontend, docker-compose for lotl.eguwallet.com"
```

---

## Phase 5: Certification Service

### Task 11: Add OIDC + frontend + deploy for Certification

**Pattern:** Same as Task 10. Apply these changes:

**Files to modify:**
- `apps/certification/src/app.module.ts`
- `apps/certification/src/main.ts`

**Files to create:**
- `apps/certification/.env.example` — `SERVICE_NAME=cert`, `PORT=3001`, `DB_NAME=eguwallet_cert`, `OIDC_ISSUER=https://cert.eguwallet.com/oidc`
- `apps/certification/docker-compose.yml`
- `apps/certification/Dockerfile` — `--project=cert`, port 3001

**Database:** `eguwallet_cert` — apply 001-common.sql, 002-audit.sql, 007-certification.sql, 100-service-oidc-base.sql

**Verify:**
```bash
curl https://cert.eguwallet.com/health
curl https://cert.eguwallet.com/oidc/.well-known/openid-configuration | python -m json.tool | grep issuer
# Expected: "issuer": "https://cert.eguwallet.com/oidc"
```

**Commit:**
```bash
git add apps/certification/
git commit -m "feat(certification): add OIDC, Angular frontend, docker-compose for cert.eguwallet.com"
```

---

## Phase 6: Wallet Provider Service

### Task 12: Add OIDC + frontend + deploy for Wallet Provider

**Pattern:** Same as Task 10. Special consideration: wallet-provider has existing OIDC-adjacent code (SIOPv2, DPoP, OpenID4VP). The new `OidcModule` provides the **admin panel OIDC** — separate from the wallet interaction endpoints.

**Files to modify:**
- `apps/wallet-provider/src/app.module.ts` — add `OidcModule` (admin OIDC), keep existing wallet authentication code
- `apps/wallet-provider/src/main.ts` — add static file serving

**Files to create:**
- `apps/wallet-provider/.env.example` — `SERVICE_NAME=wallet`, `PORT=3210`, `DB_NAME=eguwallet_wallet`, `OIDC_ISSUER=https://wallet.eguwallet.com/oidc`
- `apps/wallet-provider/docker-compose.yml`
- `apps/wallet-provider/Dockerfile` — `--project=wallet`, port 3210

**Database:** `eguwallet_wallet` — apply 001-common.sql, 002-audit.sql, 004-wallet-provider.sql, 100-service-oidc-base.sql

**Important:** The wallet-provider admin OIDC issuer is `https://wallet.eguwallet.com/oidc`. The wallet's own OpenID4VP and SIOPv2 endpoints remain at the same URLs — they are NOT protected by the admin OIDC. Only `/admin/*` and `/inspector/*` routes require the admin JWT.

**Update eguilde-portal after deploy (Phase 4 of migration):**
Update `backend/.env.production` in eguilde repo:
```bash
WALLET_PROVIDER_URL=https://wallet.eguwallet.com
EGUILDE_WALLET_URL=https://wallet.eguwallet.com
WALLET_VERIFIER_URL=https://wallet.eguwallet.com
```

**Verify:**
```bash
curl https://wallet.eguwallet.com/health
curl https://wallet.eguwallet.com/oidc/.well-known/openid-configuration | python -m json.tool | grep issuer
# Expected: "issuer": "https://wallet.eguwallet.com/oidc"

# Verify wallet-provider's own well-known still works
curl https://wallet.eguwallet.com/.well-known/openid-credential-issuer | python -m json.tool | head -5
```

**Commit:**
```bash
git add apps/wallet-provider/
git commit -m "feat(wallet-provider): add OIDC admin panel, Angular frontend, docker-compose"
```

---

## Phase 7: DGP Service

### Task 13: Add OIDC + frontend + deploy for DGP

**Pattern:** Same as Task 10.

**Files to modify:**
- `apps/dgp/src/app.module.ts`
- `apps/dgp/src/main.ts`

**Files to create:**
- `apps/dgp/.env.example` — `SERVICE_NAME=dgp`, `PORT=3011`, `DB_NAME=eguwallet_dgp`, `OIDC_ISSUER=https://dgp.eguwallet.com/oidc`
- `apps/dgp/docker-compose.yml`
- `apps/dgp/Dockerfile` — `--project=dgp`, port 3011

**Database:** `eguwallet_dgp` — apply 001-common.sql, 002-audit.sql, 009-dgp.sql, 100-service-oidc-base.sql

**Verify:**
```bash
curl https://dgp.eguwallet.com/health
curl https://dgp.eguwallet.com/oidc/.well-known/openid-configuration | python -m json.tool | grep issuer
# Expected: "issuer": "https://dgp.eguwallet.com/oidc"
```

**Commit:**
```bash
git add apps/dgp/
git commit -m "feat(dgp): add OIDC admin panel, Angular frontend, docker-compose for dgp.eguwallet.com"
```

---

## Phase 8: mTLS Inter-Service Communication

### Task 14: Extend MtlsHttpClientModule for direct service calls

**Context:** Currently services communicate via PostgreSQL LISTEN/NOTIFY (`MessagingModule`). With separate databases, this is broken. Replace with direct HTTP calls using mTLS client certificates.

**Files to create:**
- `libs/http-clients/src/mtls-client.service.ts`
- `libs/http-clients/src/mtls-client.module.ts`

**Files to modify:**
- `libs/http-clients/src/index.ts`
- `apps/lotl/src/services/lotl.service.ts` — replace MessagingService.request() with MtlsClientService
- `apps/wallet-provider/src/services/wallet.service.ts` — same
- `apps/dgp/src/services/dgp.service.ts` — same

**Step 1: Create MtlsClientService**

```typescript
// libs/http-clients/src/mtls-client.service.ts
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';
import * as https from 'https';
import axios, { AxiosInstance } from 'axios';

interface ServiceEndpoints {
  qtsp: string;
  lotl: string;
  cert: string;
  wallet: string;
  dgp: string;
}

@Injectable()
export class MtlsClientService implements OnModuleInit {
  private readonly logger = new Logger(MtlsClientService.name);
  private clients: Map<string, AxiosInstance> = new Map();

  private readonly endpoints: ServiceEndpoints;

  constructor(private readonly config: ConfigService, private readonly pg: PgService) {
    this.endpoints = {
      qtsp: config.get('QTSP_INTERNAL_URL', 'http://localhost:3103'),
      lotl: config.get('LOTL_INTERNAL_URL', 'http://localhost:3102'),
      cert: config.get('CERT_INTERNAL_URL', 'http://localhost:3101'),
      wallet: config.get('WALLET_INTERNAL_URL', 'http://localhost:3310'),
      dgp: config.get('DGP_INTERNAL_URL', 'http://localhost:3111'),
    };
  }

  async onModuleInit(): Promise<void> {
    const mtlsEnabled = this.config.get<boolean>('MTLS_ENABLED', false);

    for (const [name, baseURL] of Object.entries(this.endpoints)) {
      let httpsAgent: https.Agent | undefined;

      if (mtlsEnabled && baseURL.startsWith('https')) {
        const cert = await this.loadServiceCert();
        if (cert) {
          httpsAgent = new https.Agent({
            cert: cert.cert,
            key: cert.key,
            ca: cert.ca,
            rejectUnauthorized: true,
          });
        }
      }

      this.clients.set(name, axios.create({ baseURL, httpsAgent, timeout: 10000 }));
      this.logger.log(`Initialized HTTP client for ${name}: ${baseURL}`);
    }
  }

  async get<T>(service: keyof ServiceEndpoints, path: string): Promise<T> {
    const client = this.clients.get(service);
    if (!client) throw new Error(`No client for service: ${service}`);
    const res = await client.get<T>(path);
    return res.data;
  }

  async post<T>(service: keyof ServiceEndpoints, path: string, data: unknown): Promise<T> {
    const client = this.clients.get(service);
    if (!client) throw new Error(`No client for service: ${service}`);
    const res = await client.post<T>(path, data);
    return res.data;
  }

  private async loadServiceCert(): Promise<{ cert: string; key: string; ca: string } | null> {
    try {
      const rows = await this.pg.query<{ cert_pem: string; key_pem: string; ca_pem: string }>(
        `SELECT cert_pem, key_pem, ca_pem FROM service_certificates WHERE service_name = $1 AND active = true LIMIT 1`,
        [this.config.get('SERVICE_NAME')],
      );
      if (!rows[0]) { this.logger.warn('No mTLS service cert found in DB — using plain HTTP'); return null; }
      return { cert: rows[0].cert_pem, key: rows[0].key_pem, ca: rows[0].ca_pem };
    } catch (e) {
      this.logger.warn(`Failed to load mTLS cert: ${e} — using plain HTTP`);
      return null;
    }
  }
}
```

**Step 2: Create MtlsClientModule**

```typescript
// libs/http-clients/src/mtls-client.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PgModule } from '@app/database';
import { MtlsClientService } from './mtls-client.service';

@Module({
  imports: [ConfigModule, PgModule],
  providers: [MtlsClientService],
  exports: [MtlsClientService],
})
export class MtlsClientModule {}
```

**Step 3: Replace MessagingService usage with MtlsClientService**

Find all `this.messagingService.request(...)` calls in:
- `apps/lotl/src/services/*.ts`
- `apps/wallet-provider/src/services/*.ts`
- `apps/dgp/src/services/*.ts`
- `apps/certification/src/services/*.ts`
- `apps/qtsp/src/services/*.ts`

```bash
# Find all messaging.request calls
grep -r "messagingService.request\|MessagingService" apps/*/src/ --include="*.ts" -l
```

For each, replace pattern:
```typescript
// BEFORE (PG LISTEN/NOTIFY)
await this.messagingService.request('svc.qtsp', 'get_crl', {});

// AFTER (HTTP)
await this.mtlsClient.get('qtsp', '/api/qtsp/crl');
```

**Step 4: Remove MessagingModule imports from all service app.modules**

Since services now have separate DBs, MessagingModule (which uses shared PG LISTEN/NOTIFY) no longer works for cross-service. Remove it from each app.module.ts. The messaging table (`010-messaging.sql`) is no longer needed for inter-service communication.

**Step 5: Write test for MtlsClientService**

```typescript
// libs/http-clients/src/mtls-client.service.spec.ts
import { Test } from '@nestjs/testing';
import { MtlsClientService } from './mtls-client.service';
import { ConfigService } from '@nestjs/config';
import { PgService } from '@app/database';
import axios from 'axios';

jest.mock('axios');

describe('MtlsClientService', () => {
  let service: MtlsClientService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MtlsClientService,
        { provide: ConfigService, useValue: { get: jest.fn().mockReturnValue(false) } },
        { provide: PgService, useValue: { query: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();
    service = module.get(MtlsClientService);
    await service.onModuleInit();
  });

  it('should initialize clients for all services', () => {
    expect(service).toBeDefined();
  });
});
```

**Step 6: Run test**

```bash
bun run test libs/http-clients/src/mtls-client.service.spec.ts
```

**Step 7: Commit**

```bash
git add libs/http-clients/
git commit -m "feat(http-clients): add MtlsClientService replacing PG LISTEN/NOTIFY"
```

---

## Phase 9: Decommission API Gateway

### Task 15: Verify all services work independently, then decommission

**Step 1: Run verification checklist**

For each service, verify:
```bash
# Health
curl https://qtsp.eguwallet.com/health    # {"status":"ok"}
curl https://lotl.eguwallet.com/health    # {"status":"ok"}
curl https://cert.eguwallet.com/health    # {"status":"ok"}
curl https://wallet.eguwallet.com/health  # {"status":"ok"}
curl https://dgp.eguwallet.com/health     # {"status":"ok"}

# OIDC discovery
for sub in qtsp lotl cert wallet dgp; do
  echo "=== $sub ==="
  curl -s https://$sub.eguwallet.com/oidc/.well-known/openid-configuration | python -m json.tool | grep issuer
done

# Public endpoints
curl https://qtsp.eguwallet.com/ocsp
curl https://lotl.eguwallet.com/lotl.xml | head -5
```

**Step 2: Update eguilde-portal environment variables**

Modify `C:\dev\eguilde\backend\.env.production`:

```bash
# Replace:
EGUILDE_WALLET_URL=https://wallet.eguilde.cloud
WALLET_GATEWAY_URL=https://wallet.eguilde.cloud
WALLET_VERIFIER_URL=https://wallet.eguilde.cloud
WALLET_PROVIDER_URL=https://wallet.eguilde.cloud

# With:
EGUILDE_WALLET_URL=https://wallet.eguwallet.com
WALLET_GATEWAY_URL=https://wallet.eguwallet.com
WALLET_VERIFIER_URL=https://wallet.eguwallet.com
WALLET_PROVIDER_URL=https://wallet.eguwallet.com
```

Also update the LOTL URL used by trust.service.ts:
```bash
LOTL_URL=https://lotl.eguwallet.com/api/lotl
```

**Step 3: Redeploy eguilde-portal and test wallet login**

```bash
# In eguilde repo
git add backend/.env.production
git commit -m "config: switch wallet services to eguwallet.com subdomains"
git push
# Deploy via CI or manually on egucluster3
```

Test wallet login flow end-to-end:
1. Open `https://ilfov.net`
2. Click "Autentificare cu portofel digital"
3. Scan QR code with EUDI wallet app
4. Verify PID claims received by eguilde-portal

**Step 4: Stop api-gateway container**

```bash
ssh eguilde@egucluster3.eguilde.cloud
cd ~/eguilde_wallet
docker compose stop api-gateway
# Wait 24h to confirm nothing breaks
# Then:
docker compose rm api-gateway
```

**Step 5: Remove api-gateway from main docker-compose.yml**

```bash
# In eguilde_wallet/monoback
# Comment out or remove the api-gateway service block from docker-compose.yml
git add docker-compose.yml
git commit -m "feat: decommission api-gateway — all services now independent on eguwallet.com"
```

**Step 6: Optional — redirect old wallet.eguilde.cloud to new domain**

On egucluster3 nginx (or wherever wallet.eguilde.cloud resolves), add redirect:
```nginx
server {
    listen 443 ssl;
    server_name wallet.eguilde.cloud;
    return 301 https://wallet.eguwallet.com$request_uri;
}
```

---

## Summary: Commit Sequence

```
feat(oidc): add shared @app/oidc library with oidc-provider v9, OTP, users
feat(db): add per-service OIDC base migration and client seed
feat(frontend): add Angular 21 + PrimeNG admin frontends for all services
feat(qtsp): add OIDC provider, OTP login, static Angular serving
feat(qtsp): multi-stage Dockerfile with Angular frontend build
feat(qtsp): add standalone docker-compose for qtsp.eguwallet.com
feat(lotl): add OIDC, Angular frontend, docker-compose for lotl.eguwallet.com
feat(certification): add OIDC, Angular frontend, docker-compose for cert.eguwallet.com
feat(wallet-provider): add OIDC admin panel, Angular frontend, docker-compose
feat(dgp): add OIDC admin panel, Angular frontend, docker-compose for dgp.eguwallet.com
feat(http-clients): add MtlsClientService replacing PG LISTEN/NOTIFY
config: switch wallet services to eguwallet.com subdomains
feat: decommission api-gateway — all services now independent on eguwallet.com
```

---

## Key Configuration Reference

### Per-service .env template

```bash
NODE_ENV=production
SERVICE_NAME=<service>         # qtsp | lotl | cert | wallet | dgp
PORT=<port>                    # 3003 | 3002 | 3001 | 3210 | 3011

DB_HOST=egucluster4.eguilde.cloud
DB_PORT=5432
DB_NAME=eguwallet_<service>
DB_USER=postgres
DB_PASSWORD=<password>

OIDC_ISSUER=https://<subdomain>.eguwallet.com/oidc
API_RESOURCE=https://<subdomain>.eguwallet.com/api
FRONTEND_ORIGIN=https://<subdomain>.eguwallet.com

SMTP_HOST=<haraka-host>
SMTP_PORT=25
SMTP_FROM=noreply@eguwallet.com

# Cross-service URLs (for MtlsClientService)
QTSP_INTERNAL_URL=http://egucluster3.eguilde.cloud:3003
LOTL_INTERNAL_URL=http://egucluster3.eguilde.cloud:3002
CERT_INTERNAL_URL=http://egucluster3.eguilde.cloud:3001
WALLET_INTERNAL_URL=http://egucluster3.eguilde.cloud:3210
DGP_INTERNAL_URL=http://egucluster3.eguilde.cloud:3011

# mTLS (enable after Phase 8)
MTLS_ENABLED=false
```

### Database connection check

```bash
# Verify each service DB exists and has tables
psql -U postgres -h egucluster4.eguilde.cloud -d eguwallet_qtsp -c "\dt"
# Expected: users, oidc_models, oidc_clients, jwks_keys, server_secrets, otp_codes + domain tables
```
