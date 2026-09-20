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
