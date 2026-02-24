# eguwallet.com Redesign — Remove API Gateway, Per-Service OIDC & Subdomains

**Date:** 2026-02-21
**Status:** Approved
**Scope:** wallet-provider, lotl, certification, qtsp, dgp (DGEP excluded — in progress)

---

## Problem Statement

The current `wallet.eguilde.cloud` architecture uses a single **api-gateway** as the sole external entry point, acting as an OIDC provider and reverse proxy to all backend microservices. This creates a single point of failure, prevents independent deployment at customer premises, and bundles all auth/routing into one service.

**Goal:** Each service becomes fully independent — own subdomain, own OIDC provider, own PostgreSQL database, own Angular frontend — deployable as a standalone Docker compose stack at any customer site.

---

## Architecture Decision: Option C — Monorepo + Per-Service Docker Compose Stacks

Keep the NestJS monorepo for development efficiency. Each service gets:
- Its own `docker-compose.<service>.yml`
- Its own OIDC provider (oidc-provider v9)
- Its own PostgreSQL database (separate DB name on shared egucluster4 instance)
- Its own Angular 21 / PrimeNG / TailwindCSS 4 frontend
- Its own subdomain on `eguwallet.com`

---

## Subdomain & Domain Configuration

| Service | Subdomain | egucluster3 port |
|---|---|---|
| wallet-provider | wallet.eguwallet.com | 3210 |
| lotl | lotl.eguwallet.com | 3002 |
| certification | cert.eguwallet.com | 3001 |
| qtsp | qtsp.eguwallet.com | 3003 |
| dgp | dgp.eguwallet.com | 3011 |
| dgep (later) | dgep.eguwallet.com | 3010 |

**DNS:** GoDaddy API (keys already in eguilde `.env`) sets:
- `A eguwallet.com → egucluster1 IP`
- `A *.eguwallet.com → egucluster1 IP`

---

## Infrastructure: egucluster1 (Nginx + Wildcard SSL)

**Server:** `eguilde@egucluster1.eguilde.cloud` (sudo password: Egu45ilde)

### Wildcard SSL via Let's Encrypt DNS-01

```bash
certbot certonly \
  --dns-godaddy \
  --dns-godaddy-credentials /etc/letsencrypt/godaddy.ini \
  -d "eguwallet.com" \
  -d "*.eguwallet.com"
```

GoDaddy credentials file:
```ini
dns_godaddy_secret = <GODADDY_API_SECRET>
dns_godaddy_key    = <GODADDY_API_KEY>
```

Auto-renewal via cron: `certbot renew --quiet`

### Nginx Configuration Pattern (per subdomain)

```nginx
server {
    listen 443 ssl http2;
    server_name wallet.eguwallet.com;

    ssl_certificate     /etc/letsencrypt/live/eguwallet.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/eguwallet.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;

    client_max_body_size 10m;

    location / {
        proxy_pass         http://egucluster3.eguilde.cloud:3210;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}

server {
    listen 80;
    server_name *.eguwallet.com eguwallet.com;
    return 301 https://$host$request_uri;
}
```

---

## Per-Service Structure (repeating pattern)

Every service follows the same internal blueprint, modeled after the eguilde project.

### NestJS Service Layout

```
apps/<service>/
├── src/
│   ├── main.ts                       # Bootstrap; serves Angular static files
│   ├── app.module.ts                 # Root module
│   ├── oidc/                         # oidc-provider v9
│   │   ├── oidc.service.ts           # Provider init, PKCE, JWKS
│   │   ├── oidc.controller.ts        # /.well-known/*, /oidc/* endpoints
│   │   └── adapters/pg.adapter.ts    # PostgreSQL persistence
│   ├── interactions/                 # OTP login flow
│   │   ├── interactions.controller.ts
│   │   └── interactions.service.ts
│   ├── auth/                         # BFF token exchange (PKCE code → token)
│   │   └── auth.controller.ts
│   ├── users/                        # User management + RBAC seeding
│   │   └── users.service.ts          # Seeds thomas@eguilde.cloud as GLOBAL_ADMIN
│   ├── database/                     # PgModule pointing to service's own DB
│   ├── email/                        # OTP email delivery (Haraka or SMTP)
│   └── <domain>/                     # Existing domain logic (qtsp/, lotl/, etc.)
│
├── frontend/                         # Angular 21 + PrimeNG + TailwindCSS 4
│   └── src/app/
│       ├── auth/                     # @eguilde/oauth2-client PKCE flow
│       ├── admin/                    # Admin dashboard (service-specific)
│       ├── inspector/                # Read-only inspector views
│       └── shell/                    # Navbar, sidebar, router outlet
│
└── docker-compose.<service>.yml      # Self-contained deployment stack
```

### OIDC Provider (per service)

- **Library:** oidc-provider v9 (upgrade from current v8)
- **Adapter:** PostgreSQL (identical to eguilde `pg.adapter.ts`)
- **Flow:** Authorization Code + PKCE (SPA — no client secret)
- **Login method:** OTP via email only (no passkey, no wallet login)
- **Issuer:** `https://<subdomain>.eguwallet.com/oidc`
- **Client:** `<service>-spa` registered in `oidc_clients` table
- **Redirect URIs:** `https://<subdomain>.eguwallet.com/auth/callback`

### RBAC (per service)

| Role | Permissions |
|---|---|
| `<SERVICE>_ADMIN` | Full CRUD on all service resources |
| `<SERVICE>_INSPECTOR` | Read-only access to all service resources |

Default admin seeded at startup: `thomas@eguilde.cloud` with `<SERVICE>_ADMIN`.

### Database (per service)

| Service | Database name |
|---|---|
| qtsp | eguwallet_qtsp |
| lotl | eguwallet_lotl |
| certification | eguwallet_cert |
| wallet-provider | eguwallet_wallet |
| dgp | eguwallet_dgp |

**Common tables per service:** `users`, `oidc_models`, `oidc_clients`, `jwks_keys`, `otp_codes`, `server_secrets` + domain-specific tables.

### Angular Frontend (per service)

- Served as static files by NestJS (`express.static` on Angular dist output)
- NestJS catch-all route returns `index.html` for Angular router deep links
- Transloco i18n: Romanian default (`ro`), English secondary (`en`)
- PrimeNG Aura theme, TailwindCSS 4 layout utilities only (no color utilities)
- Two route groups: `/admin/*` (full CRUD) and `/inspector/*` (read-only)
- Auth via `@eguilde/oauth2-client` library (same as eguilde portal)

---

## QTSP Public Endpoints

QTSP exposes both admin UI and RFC-mandated public endpoints:

```
qtsp.eguwallet.com
├── /oidc/*              Admin OIDC provider (auth-protected)
├── /admin/*             Angular admin frontend (auth-protected)
├── /inspector/*         Angular inspector frontend (auth-protected)
├── /ocsp                RFC 6960 OCSP responder        (PUBLIC — no auth)
├── /crl/<issuer>.crl    RFC 5280 CRL distribution point (PUBLIC — no auth)
└── /tsa                 RFC 3161 Timestamp Authority    (PUBLIC — no auth)
```

OCSP, CRL, and TSA endpoints use `@Public()` decorator — they must be reachable by any relying party worldwide without authentication.

## LOTL Public Endpoints

```
lotl.eguwallet.com
├── /oidc/*              Admin OIDC provider (auth-protected)
├── /admin/*             Angular admin frontend (auth-protected)
├── /lotl.xml            Trust list XML signed document (PUBLIC)
└── /api/lotl            Trust list JSON API (PUBLIC — for wallets/verifiers)
```

---

## mTLS Inter-Service Communication

### Certificate Authority

QTSP acts as the internal Root CA:

```
QTSP Root CA  (self-signed, generated at QTSP first-boot, stored in eguwallet_qtsp)
   └── Issues service certificates to:
         wallet-provider  →  wallet client cert
         lotl             →  lotl client cert
         certification    →  certification client cert
         dgp              →  dgp client cert
```

### Port Architecture

Each service runs two servers:

| Service | External port (nginx target) | Internal mTLS port |
|---|---|---|
| qtsp | 3003 | 3103 |
| lotl | 3002 | 3102 |
| certification | 3001 | 3101 |
| wallet-provider | 3210 | 3310 |
| dgp | 3011 | 3111 |

- **External port:** plain HTTP, nginx terminates TLS externally
- **Internal mTLS port:** HTTPS with client cert validation, only reachable within egucluster3 (not exposed via nginx)

### Bootstrap Sequence

```
1. QTSP starts → generates Root CA if not exists
2. LOTL, Certification start → request service certs from QTSP internal API
3. Wallet Provider, DGP start → same
```

Docker compose `depends_on` with health checks enforces this order.

### Cross-Service Call Matrix

| Caller | Callee | Purpose |
|---|---|---|
| wallet-provider | lotl | Fetch trusted issuers list |
| wallet-provider | qtsp | Verify certificate chains |
| dgp | qtsp | Request passport signing certificate |
| lotl | qtsp | Sign trust list XML |
| certification | qtsp | Sign audit certificates |
| eguilde-portal | wallet-provider | Wallet attestation (public HTTPS) |
| eguilde-portal | lotl | Trust validation (public HTTPS) |

### Implementation

Extend existing `libs/mtls-bootstrap/` and `libs/http-clients/` to provide a `MtlsHttpClientModule` — wraps axios with client cert loaded from service DB. Inter-service calls use this client.

Replace all PostgreSQL LISTEN/NOTIFY cross-service calls with HTTP calls via mTLS internal ports.

---

## Migration Strategy

**Principle:** Old `wallet.eguilde.cloud` stays live until Phase 4. Rollback available at every phase.

### Phase 0 — Infrastructure (no service changes)
- Set up wildcard cert on egucluster1
- Configure GoDaddy DNS: `*.eguwallet.com → egucluster1 IP`
- Configure nginx on egucluster1 (all server blocks defined, proxying to egucluster3)

### Phase 1 — QTSP
- Add OIDC + own DB (`eguwallet_qtsp`) + Angular frontend to qtsp service
- Deploy `docker-compose.qtsp.yml` on egucluster3
- `qtsp.eguwallet.com` goes live
- `wallet.eguilde.cloud/qtsp/` still works (old nginx untouched)

### Phase 2 — LOTL + Certification
- Add OIDC + own DB + Angular frontend to lotl and certification
- Deploy `docker-compose.lotl.yml` + `docker-compose.cert.yml`
- `lotl.eguwallet.com` + `cert.eguwallet.com` go live

### Phase 3 — Wallet Provider + DGP
- Add OIDC + own DB + Angular frontend
- Deploy `docker-compose.wallet-provider.yml` + `docker-compose.dgp.yml`
- `wallet.eguwallet.com` + `dgp.eguwallet.com` go live
- Switch eguilde-portal env vars to new URLs

### Phase 4 — Decommission api-gateway + old domain
- Verify all eguilde-portal integrations work with new service URLs
- Update eguilde backend `.env`:
  ```
  WALLET_GATEWAY_URL=https://wallet.eguwallet.com
  WALLET_VERIFIER_URL=https://wallet.eguwallet.com
  WALLET_PROVIDER_URL=https://wallet.eguwallet.com
  ```
- Remove api-gateway from docker compose
- Remove or redirect `wallet.eguilde.cloud` nginx config

### Phase 5 — DGEP (when ready)
- DGEP follows same pattern
- `dgep.eguwallet.com` goes live

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---|---|---|
| OIDC library | oidc-provider v9 | Same as eguilde; upgrade from current v8 |
| DB isolation | Separate DB names, shared PG instance | Simple now; migrate to containerized PG per customer deployment later |
| Inter-service | HTTP + mTLS replacing PG LISTEN/NOTIFY | Required with separate DBs; also cleaner for cross-server deployment |
| TLS termination | Nginx on egucluster1 (external), internal mTLS direct | nginx handles external certs; mTLS for service-to-service trust |
| Frontend | Angular 21 + PrimeNG Aura + TailwindCSS 4 | Consistent with eguilde project |
| Auth method | OTP only (no passkey/wallet) | Admin panels don't need hardware-backed auth |
| Login default | thomas@eguilde.cloud seeded as admin | Consistent default across all services |

---

## Files To Create / Modify Per Service

### New files (per service, 5 services × ~20 files)
- `apps/<service>/src/oidc/oidc.service.ts`
- `apps/<service>/src/oidc/oidc.controller.ts`
- `apps/<service>/src/oidc/adapters/pg.adapter.ts`
- `apps/<service>/src/interactions/interactions.controller.ts`
- `apps/<service>/src/interactions/interactions.service.ts`
- `apps/<service>/src/auth/auth.controller.ts`
- `apps/<service>/src/users/users.service.ts`
- `apps/<service>/src/database/database.module.ts`
- `apps/<service>/src/email/email.service.ts`
- `apps/<service>/frontend/` (Angular app, ~15 files per service)
- `apps/<service>/docker-compose.<service>.yml`
- `apps/<service>/.env.<service>.example`

### Modified files
- `apps/<service>/src/main.ts` — add static file serving + catch-all route
- `apps/<service>/src/app.module.ts` — add OidcModule, AuthModule, UsersModule
- `libs/http-clients/` — add MtlsHttpClientModule
- `libs/mtls-bootstrap/` — extend for per-service cert loading
- `nginx/` — add per-subdomain server blocks
- `scripts/setup-ssl.sh` — add certbot-dns-godaddy setup

### eguilde-portal changes (Phase 3-4)
- `backend/.env.production` — update wallet service URLs to eguwallet.com
- `backend/src/verifier/trust.service.ts` — update LOTL endpoint URL
- `backend/src/pid-issuer/pid-issuer.service.ts` — update DGEP endpoint URL
