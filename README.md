# Inventory, QR Product Catalog & Sales Management

A mobile-first inventory, QR product catalog, and sales management app for a small business, built with Next.js, Drizzle ORM, and PostgreSQL.

## Development

1. Copy `.env.example` to `.env.local` and fill in `DATABASE_URL`, `AUTH_SECRET` (generate with `npx auth secret`), and R2 credentials.
2. Install dependencies: `npm install`
3. Run migrations: `npx drizzle-kit migrate`
4. Seed the database: `npm run db:seed`
5. Start the dev server: `npm run dev`

**Seed admin login (development only):**
- Email: `admin@example.com`
- Password: `ChangeMe123!`

Do not use these credentials in production — create a real admin user via the app's user management (added in a later phase) and disable/remove this seed account.

## Architecture Notes

**Authorization:** The `(app)` route group's layout (`app/(app)/layout.tsx`) calls `requireUser()` and guards every page nested under it. This guard does NOT run for Route Handlers (`app/api/**/route.ts`) or Server Actions — Next.js layouts only wrap pages. Every Route Handler and Server Action that requires authentication must call `requireUser()` or `requireAdmin()` (from `@/lib/auth/guards`) itself, at the top of the handler, before doing any work. Do not rely on the `(app)` layout to protect API routes.

## Deployment (Railway)

The app deploys as a single Docker container. Railway builds the image itself from the `Dockerfile` in this repo — there's no separate registry to manage.

### One-time setup

1. **Create a Railway project** (if you don't have one) at [railway.com](https://railway.com).
2. **Add a PostgreSQL database**: in the project, click **New → Database → Add PostgreSQL**.
3. **Add this repo as a service**: click **New → GitHub Repo**, connect this repository (push it to GitHub first if it isn't there yet — `git remote add origin <your-repo-url>` then `git push -u origin master`), and select it. Railway will detect the `Dockerfile` automatically (confirmed by `railway.json`'s `"builder": "DOCKERFILE"`).
4. **Set environment variables** on the app service (Settings → Variables):
   - `DATABASE_URL` — reference the Postgres service's private URL. In Railway you can do this with a variable reference: `${{Postgres.DATABASE_URL}}` (use the actual service name shown in your project — commonly `Postgres`). This uses Railway's private network, which is faster and doesn't count against egress.
   - `AUTH_SECRET` — generate one locally with `npx auth secret` and paste the value (a fresh one for production, don't reuse your local dev secret).
   - `APP_URL` — set to your Railway-provided public domain once you have one, e.g. `https://your-app.up.railway.app` (Settings → Networking → Generate Domain if you haven't already).
   - R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL`) — required once product photo upload ships in a later phase; not required for the current build to boot.
5. **Deploy**: Railway deploys automatically on push to the connected branch. The container runs `npm run start:prod` on boot, which runs `drizzle-kit migrate` against `DATABASE_URL` before starting the server — new migrations apply automatically on every deploy, no manual step needed.
6. **Seed the production admin user** (first deploy only): from your local machine, run the seed script against the production database:
   ```bash
   DATABASE_URL="<production DATABASE_PUBLIC_URL from Railway>" npx tsx scripts/seed.ts
   ```
   Then immediately change that account's password or create a proper admin user and disable the seed account — the seeded credentials (`admin@example.com` / `ChangeMe123!`) are for development only and must not remain active in production.

### Every subsequent deploy

Just `git push` to the connected branch. Railway rebuilds the Docker image, runs migrations, and restarts the service automatically.

### Local verification before deploying

To sanity-check the production build path locally before pushing (recommended after any change to `Dockerfile`, `next.config.ts`, or dependencies):

```bash
npm run build
DATABASE_URL="<your DATABASE_URL>" AUTH_SECRET="<your secret>" APP_URL="http://localhost:3000" npx drizzle-kit migrate
node .next/standalone/server.js
```

If Docker Desktop is running, you can also build and run the actual container image:

```bash
docker build -t inventory-app .
docker run -p 3000:3000 \
  -e DATABASE_URL="<your DATABASE_URL>" \
  -e AUTH_SECRET="<your secret>" \
  -e APP_URL="http://localhost:3000" \
  inventory-app
```

## QR System

Each product can generate a unique QR code that points to its public product page. When someone scans the QR code, they land on the product's public view at `/p/[publicIdentifier]`:

- **Public visitor** — sees a restricted view with product image, name, and selling price.
- **Logged-in user** — sees the full internal product record (including SKU, status, quantity, cost price, supplier, location, description, and notes).

**Important:** The `APP_URL` environment variable must be set to the correct production domain. This is used to generate the QR code's URL; if `APP_URL` is incorrect, printed QR codes will resolve to the wrong domain in the field.

**Regenerating a QR code** invalidates all previously printed copies. If you regenerate a product's QR code, you must reprint any copies that were already distributed, or they will no longer scan to the correct product.
