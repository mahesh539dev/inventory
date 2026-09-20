This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

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
