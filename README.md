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

## Running it locally

### With Docker Compose

```bash
cp .env.example .env
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

- **Mobile** endpoints (`/api/app/...`) expect `Authorization: Bearer <token>` whose
  payload carries `sub` = the user's `externalId` (e.g. `user-alice`). The mock auth
  service treats any non-empty token as active.
- **Admin** endpoints (`/api/admin/...`) accept a legacy HS256 token signed with
  `JWT_SECRET` carrying `{ id, username, merchantId }`.
- **Partner** endpoints (`/api/partner/...`) use HTTP Basic with
  `PARTNER_USER`/`PARTNER_PASS`.
- **Webhooks** (`/api/webhooks/catalog/...`) receive product events from the catalog
  platform.
- **Jobs** (`/api/jobs/...`) are triggered by the scheduler.
