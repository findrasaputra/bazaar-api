# Bazaar API

Marketplace backend for the Bazaar mobile app and merchant admin portal.
Express + Sequelize (Postgres), with a mobile API, a merchant admin API,
catalog webhooks, scheduled jobs, and a logistics-partner API.

## Stack

- Node 20, Express 4
- Sequelize 6 on Postgres
- A "catalog" platform and an "auth" service, both reached over HTTP (stubbed by a
  local mock for development)
- S3-compatible object storage (AWS SDK v3), multer uploads
- JWT auth: an introspection-based token for the mobile app, and a Keycloak-style
  JWKS/legacy-HS256 token for admins

## Layout

```
server.js               app bootstrap, middleware, route mounting
config/                 db + auth config
app/models/             Sequelize models
app/middleware/         auth (app/admin/partner), request logger, upload, validators, audit
app/services/           catalog client, wallet, storage, logger
app/controllers/        app (mobile), admin, webhook, jobs
app/routes/             route tables
mock/upstream.js        local stand-in for catalog + auth services
scripts/seed.js         seed merchants, products, users, wallets, staff
```

## Configuration

All configuration comes from environment variables. Copy the template and adjust
as needed:

```bash
cp .env.example .env
```

The defaults point the catalog and auth services at the local mock
(`http://localhost:9000`) and the database at `localhost:5432`.

Set `JWT_SECRET` to 32+ random characters (`openssl rand -hex 32`) before
starting; with an empty or weak value, legacy admin tokens are rejected. Set
`CATALOG_WEBHOOK_SECRET` to the secret configured on the catalog's webhooks.

## Running it locally

### With Docker Compose

```bash
cp .env.example .env             # then set JWT_SECRET (see Configuration)
docker compose up --build        # api :8080, mock upstream :9000, postgres :5432
docker compose exec api npm run seed
```

Compose reads `DB_USER`, `DB_PASSWORD` and `DB_NAME` from `.env` to initialise
Postgres, and points the API at the `db` and `upstream` containers.

### By hand

You need a running Postgres that matches the `DB_*` values in `.env`.

```bash
npm install
cp .env.example .env                     # adjust DB_* to your Postgres
node mock/upstream.js &                  # stub catalog + auth on :9000
npm run seed                             # seed demo data
npm start                                # or: npm run dev
```

Seed data includes two merchants, three products, two app users (`user-alice`,
`user-bob`) each with a 100.00 wallet, one address and one staff code.

## Calling the API

- **Mobile** endpoints (`/api/app/...`) expect `Authorization: Bearer <token>` issued
  by the auth service. The API asks the auth service who the token belongs to
  (`sub` = the user's `externalId`). Locally, log in through the mock to get one;
  mock tokens are lost when the mock restarts:

  ```bash
  curl -s -X POST localhost:9000/auth/login -H 'Content-Type: application/json' \
    -d '{"externalId":"user-alice"}'          # -> { "access_token": "..." }
  ```

  A login with no matching customer account gets 403; if the auth service is
  unreachable, requests get 503.
- **Admin** endpoints (`/api/admin/...`) accept a Keycloak token from the
  `OIDC_REALM` realm issued to `OIDC_CLIENT_ID`, or a legacy HS256 token signed with
  `JWT_SECRET` carrying `{ id, username, merchantId, roles }` and an `exp`. Tokens
  without `roles` count as `merchant`. For local use:

  ```bash
  node scripts/admin-token.js owner merchant 1   # store owner of merchant 1
  node scripts/admin-token.js ops admin          # platform admin
  ```

  Roles: `admin` is the platform operator (all stores); `merchant` owns a store and
  manages its products; `staff` works a store's orders. Merchant and staff accounts
  must belong to a store.
- **Partner** endpoints (`/api/partner/...`) use HTTP Basic with
  `PARTNER_USER`/`PARTNER_PASS`.
- **Webhooks** (`/api/webhooks/catalog/...`) receive product events from the catalog
  platform and require a valid `X-WC-Webhook-Signature` (base64 HMAC-SHA256 of the
  body, keyed with `CATALOG_WEBHOOK_SECRET`).
- **Jobs** (`/api/jobs/...`) are triggered by the scheduler and require an
  `X-Job-Token` header matching `JOB_TOKEN`.

## Operations notes

- Catalog customer accounts created before version 1.5.0 share the password
  `default`. New accounts get a random password. Force a password reset for the
  older accounts in the catalog (WooCommerce) admin.
