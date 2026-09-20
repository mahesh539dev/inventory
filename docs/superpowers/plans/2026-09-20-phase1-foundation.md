# Phase 1 — Project Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the Next.js/TypeScript/Tailwind app with Drizzle ORM + PostgreSQL migrations, Auth.js credentials-based authentication, base authenticated layout with mobile-first nav, and verify the app runs end-to-end (login → protected dashboard stub).

**Architecture:** Single Next.js 14+ App Router project. Drizzle ORM talks to Railway PostgreSQL over the public proxy URL during local dev. Auth.js v5 (beta) with a Credentials provider backed by the `users` table (bcrypt password hashes), JWT session strategy (no separate sessions table needed for 2-3 users). Route groups split `(auth)` (login, no nav chrome) from `(app)` (authenticated, mobile nav + desktop sidebar).

**Tech Stack:** Next.js 14+, TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM + drizzle-kit, PostgreSQL (Railway), Auth.js v5 (next-auth@beta), bcryptjs, Zod, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-20-inventory-qr-sales-app-design.md](../specs/2026-09-20-inventory-qr-sales-app-design.md)

## Global Constraints

- Mobile-first UI; all pages must work on iPhone/Android/mobile Chrome/mobile Safari, desktop still functional.
- No microservices, no Redis/Kafka/Kubernetes — single Next.js service only.
- Business logic must stay server-side (services/repositories), never trusted from the client.
- Never store plaintext passwords — bcrypt hashing only.
- Use database migrations for every schema change — never hand-edit the DB schema.
- Never commit secrets — `.env.local` is git-ignored, `.env.example` documents required vars with placeholder values.
- Package manager is npm (per approved design decision).
- Roles are exactly `ADMIN` and `USER` (spec section 25).

---

### Task 1: Scaffold Next.js project with TypeScript, Tailwind, and base tooling

**Files:**
- Create: entire Next.js scaffold (`package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `.gitignore`, `eslint.config.mjs`)

**Interfaces:**
- Produces: a running Next.js dev server at `npm run dev`, App Router under `app/`, Tailwind configured, TypeScript strict mode.

- [ ] **Step 1: Run create-next-app in the current directory**

```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir=false --import-alias "@/*" --use-npm --no-turbopack
```

When prompted about the current directory not being empty, confirm to proceed (it will merge with existing `inventory_qr_sales_app_claude_prompt.md` and `docs/`).

- [ ] **Step 2: Verify TypeScript strict mode is enabled**

Open `tsconfig.json` and confirm `"strict": true` is set under `compilerOptions`. `create-next-app` sets this by default — if not present, add it.

- [ ] **Step 3: Verify the dev server runs**

Run: `npm run dev` in the background, then check `curl http://localhost:3000` returns HTML containing `<html`.

Expected: HTTP 200 response with the default Next.js starter page markup. Stop the dev server after confirming.

- [ ] **Step 4: Update .gitignore for env files**

Confirm `.gitignore` includes (add any missing lines):
```
.env
.env.local
.env*.local
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Scaffold Next.js app with TypeScript, Tailwind, ESLint"
```

---

### Task 2: Install shadcn/ui and add base components

**Files:**
- Create: `components.json`, `lib/utils.ts`, `components/ui/button.tsx`, `components/ui/input.tsx`, `components/ui/label.tsx`, `components/ui/card.tsx`

**Interfaces:**
- Produces: `cn()` helper in `lib/utils.ts` used by all future components; shadcn `Button`, `Input`, `Label`, `Card` components under `components/ui/`.

- [ ] **Step 1: Initialize shadcn/ui**

```bash
npx shadcn@latest init -d
```

This creates `components.json` and `lib/utils.ts` with defaults (New York style, neutral base color, CSS variables).

- [ ] **Step 2: Add the base components needed for the login form and layout shells**

```bash
npx shadcn@latest add button input label card
```

- [ ] **Step 3: Verify the components compile**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add shadcn/ui base components"
```

---

### Task 3: Set up Drizzle ORM, schema, and migrations against Railway PostgreSQL

**Files:**
- Create: `lib/db/schema.ts`, `lib/db/client.ts`, `drizzle.config.ts`, `.env.example`, `.env.local` (git-ignored, not committed)
- Test: `tests/unit/schema.test.ts`

**Interfaces:**
- Produces: Drizzle `db` client exported from `lib/db/client.ts` as `export const db: NodePgDatabase<typeof schema>`; all table definitions exported from `lib/db/schema.ts` (`users`, `categories`, `products`, `inventoryTransactions`, `sales`, `saleItems`, `auditLogs`) plus pgEnum exports `userRoleEnum`, `productStatusEnum`, `inventoryTransactionTypeEnum`, `saleStatusEnum`.

- [ ] **Step 1: Install Drizzle and Postgres driver**

```bash
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg
```

- [ ] **Step 2: Create .env.example documenting required variables**

```env
# PostgreSQL connection (Railway Postgres public proxy URL for local dev,
# private DATABASE_URL is injected automatically in Railway production)
DATABASE_URL="postgresql://user:password@host:port/database"

# Auth.js
AUTH_SECRET="generate-with: npx auth secret"

# Public app URL (used to build QR code target URLs)
APP_URL="http://localhost:3000"

# Cloudflare R2 (S3-compatible object storage for product photos)
R2_ACCOUNT_ID=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_BUCKET=""
R2_PUBLIC_URL=""
```

- [ ] **Step 2b: Create .env.local with the real Railway connection string**

Create `.env.local` (already git-ignored from Task 1) with:
```env
DATABASE_URL="postgresql://postgres:nMekEShfTBnyLHChuYEecbNHoXxwvaQs@shuttle.proxy.rlwy.net:46616/railway"
AUTH_SECRET="<run: npx auth secret, paste output here>"
APP_URL="http://localhost:3000"
```

Run `npx auth secret` separately (Task 4 installs the `auth` package first — if this command isn't available yet, generate a random 32-byte base64 secret instead: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`) and paste the value in.

- [ ] **Step 3: Write the Drizzle schema**

Create `lib/db/schema.ts`:

```typescript
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "USER"]);
export const productStatusEnum = pgEnum("product_status", ["ACTIVE", "ARCHIVED"]);
export const inventoryTransactionTypeEnum = pgEnum("inventory_transaction_type", [
  "PURCHASE",
  "SALE",
  "RETURN",
  "ADJUSTMENT",
  "DAMAGE",
  "OTHER",
]);
export const saleStatusEnum = pgEnum("sale_status", ["COMPLETED", "CANCELLED", "RETURNED"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  role: userRoleEnum("role").notNull().default("USER"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("users_email_idx").on(table.email),
]);

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("categories_name_idx").on(table.name),
]);

export const products = pgTable("products", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicIdentifier: varchar("public_identifier", { length: 32 }).notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  productName: varchar("product_name", { length: 255 }).notNull(),
  categoryId: uuid("category_id").references(() => categories.id),
  description: text("description"),
  productImage: text("product_image"),
  originalPrice: numeric("original_price", { precision: 12, scale: 2 }).notNull(),
  costPrice: numeric("cost_price", { precision: 12, scale: 2 }).notNull(),
  sellingPrice: numeric("selling_price", { precision: 12, scale: 2 }),
  currentQuantity: integer("current_quantity").notNull().default(0),
  supplier: varchar("supplier", { length: 255 }),
  location: varchar("location", { length: 255 }),
  status: productStatusEnum("status").notNull().default("ACTIVE"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("products_public_identifier_idx").on(table.publicIdentifier),
  uniqueIndex("products_sku_idx").on(table.sku),
  index("products_product_name_idx").on(table.productName),
  check("products_quantity_non_negative", sql`${table.currentQuantity} >= 0`),
]);

export const inventoryTransactions = pgTable("inventory_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => products.id),
  type: inventoryTransactionTypeEnum("type").notNull(),
  quantity: integer("quantity").notNull(),
  referenceId: uuid("reference_id"),
  notes: text("notes"),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("inventory_transactions_product_id_idx").on(table.productId),
]);

export const sales = pgTable("sales", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleNumber: varchar("sale_number", { length: 32 }).notNull(),
  soldAt: timestamp("sold_at", { withTimezone: true }).notNull().defaultNow(),
  soldBy: uuid("sold_by").notNull().references(() => users.id),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
  totalProfit: numeric("total_profit", { precision: 12, scale: 2 }).notNull(),
  status: saleStatusEnum("status").notNull().default("COMPLETED"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("sales_sale_number_idx").on(table.saleNumber),
  index("sales_sold_at_idx").on(table.soldAt),
]);

export const saleItems = pgTable("sale_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  saleId: uuid("sale_id").notNull().references(() => sales.id),
  productId: uuid("product_id").notNull().references(() => products.id),
  quantity: integer("quantity").notNull(),
  costPerUnit: numeric("cost_per_unit", { precision: 12, scale: 2 }).notNull(),
  soldPricePerUnit: numeric("sold_price_per_unit", { precision: 12, scale: 2 }).notNull(),
  totalCost: numeric("total_cost", { precision: 12, scale: 2 }).notNull(),
  totalRevenue: numeric("total_revenue", { precision: 12, scale: 2 }).notNull(),
  profit: numeric("profit", { precision: 12, scale: 2 }).notNull(),
}, (table) => [
  index("sale_items_sale_id_idx").on(table.saleId),
  index("sale_items_product_id_idx").on(table.productId),
]);

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  action: varchar("action", { length: 100 }).notNull(),
  entityType: varchar("entity_type", { length: 100 }).notNull(),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 4: Create the Drizzle client**

Create `lib/db/client.ts`:

```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is not set");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });
```

- [ ] **Step 5: Create drizzle.config.ts**

```typescript
import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Install dotenv for config loading: `npm install -D dotenv`

- [ ] **Step 6: Generate and run the initial migration**

```bash
npx drizzle-kit generate --name init
npx drizzle-kit migrate
```

Expected: `drizzle/` directory created with a `0000_init.sql` file; migration runs against the Railway DB without error.

- [ ] **Step 7: Verify tables exist in the database**

```bash
npx drizzle-kit studio
```

Expected: Drizzle Studio opens (prints a local URL) and lists all 7 tables (`users`, `categories`, `products`, `inventory_transactions`, `sales`, `sale_items`, `audit_logs`). Stop it with Ctrl+C after confirming.

- [ ] **Step 8: Write a schema smoke test**

Create `tests/unit/schema.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { users, products, sales, saleItems, inventoryTransactions, auditLogs, categories } from "@/lib/db/schema";

describe("schema", () => {
  it("exports all expected tables", () => {
    expect(users).toBeDefined();
    expect(categories).toBeDefined();
    expect(products).toBeDefined();
    expect(inventoryTransactions).toBeDefined();
    expect(sales).toBeDefined();
    expect(saleItems).toBeDefined();
    expect(auditLogs).toBeDefined();
  });
});
```

(Vitest is installed and configured in Task 6 — this test file is created now but run for the first time in Task 6, Step 3.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "Add Drizzle schema, client, and initial migration"
```

Note: `.env.local` is git-ignored and will not be committed — verify with `git status` that it does not appear in the commit.

---

### Task 4: Set up Auth.js with credentials provider and password hashing

**Files:**
- Create: `lib/auth/config.ts`, `auth.ts` (repo root, Auth.js v5 convention), `app/api/auth/[...nextauth]/route.ts`, `lib/auth/session.ts`, `lib/auth/guards.ts`
- Test: `tests/unit/guards.test.ts`

**Interfaces:**
- Produces: `auth()` function (session getter, from `auth.ts`), `signIn`/`signOut` server actions re-exported from `auth.ts`; `requireUser()` and `requireAdmin()` guard functions in `lib/auth/guards.ts` that throw a redirect to `/login` (or a 403-style error for `requireAdmin` on non-admins) — later tasks call these at the top of protected server actions/pages.

- [ ] **Step 1: Install Auth.js and bcrypt**

```bash
npm install next-auth@beta bcryptjs
npm install -D @types/bcryptjs
```

- [ ] **Step 2: Create the Auth.js config**

Create `lib/auth/config.ts`:

```typescript
import type { NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;
        if (!email || !password) return null;

        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email.toLowerCase().trim()))
          .limit(1);

        if (!user || !user.active) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.role = (user as { role: string }).role;
        token.id = user.id as string;
      }
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        (session.user as typeof session.user & { role: string; id: string }).role =
          token.role as string;
        (session.user as typeof session.user & { role: string; id: string }).id =
          token.id as string;
      }
      return session;
    },
  },
};
```

- [ ] **Step 3: Create the root auth.ts entry point**

Create `auth.ts` at the repo root:

```typescript
import NextAuth from "next-auth";
import { authConfig } from "@/lib/auth/config";

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
```

- [ ] **Step 4: Wire the route handler**

Create `app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 5: Create session/guard helpers**

Create `lib/auth/session.ts`:

```typescript
import { auth } from "@/auth";

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: "ADMIN" | "USER";
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user) return null;
  return session.user as SessionUser;
}
```

Create `lib/auth/guards.ts`:

```typescript
import { redirect } from "next/navigation";
import { getSessionUser, type SessionUser } from "./session";

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new Error("Forbidden: admin role required");
  }
  return user;
}
```

- [ ] **Step 6: Write a guard unit test**

Create `tests/unit/guards.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));

import { getSessionUser } from "@/lib/auth/session";
import { requireUser, requireAdmin } from "@/lib/auth/guards";

describe("requireAdmin", () => {
  it("throws Forbidden for a USER role", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "1",
      role: "USER",
      email: "u@example.com",
    });
    await expect(requireAdmin()).rejects.toThrow("Forbidden");
  });

  it("returns the user for an ADMIN role", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "1",
      role: "ADMIN",
      email: "a@example.com",
    });
    await expect(requireAdmin()).resolves.toMatchObject({ role: "ADMIN" });
  });
});

describe("requireUser", () => {
  it("redirects when there is no session", async () => {
    vi.mocked(getSessionUser).mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT");
  });
});
```

(Run in Task 6 once Vitest is configured.)

- [ ] **Step 7: Add AUTH_SECRET to .env.local if not already generated**

```bash
npx auth secret
```

This writes/updates `AUTH_SECRET` in `.env.local` automatically. Confirm it's present.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add Auth.js credentials provider and role guards"
```

---

### Task 5: Build login page and authenticated app shell with mobile nav

**Files:**
- Create: `app/(auth)/login/page.tsx`, `app/(auth)/layout.tsx`, `lib/actions/auth.actions.ts`, `app/(app)/layout.tsx`, `app/(app)/dashboard/page.tsx`, `components/nav/MobileNav.tsx`, `components/nav/DesktopSidebar.tsx`
- Modify: `app/page.tsx` (redirect `/` to `/dashboard` or `/login`)

**Interfaces:**
- Consumes: `signIn` from `@/auth` (Task 4), `requireUser()` from `@/lib/auth/guards` (Task 4), shadcn `Button`/`Input`/`Label`/`Card` (Task 2).
- Produces: working login flow; `(app)` route group layout that all future authenticated pages (`/dashboard`, `/products`, `/sell`, `/scan`, `/sales`, `/reports`, `/settings`) will nest under.

- [ ] **Step 1: Create the login server action**

Create `lib/actions/auth.actions.ts`:

```typescript
"use server";

import { signIn } from "@/auth";
import { AuthError } from "next-auth";

export type LoginState = { error?: string } | undefined;

export async function loginAction(
  _prevState: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = formData.get("email");
  const password = formData.get("password");

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/dashboard",
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Invalid email or password" };
    }
    throw error;
  }
}
```

- [ ] **Step 2: Create the (auth) layout and login page**

Create `app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-muted/30 px-4">
      {children}
    </div>
  );
}
```

Create `app/(auth)/login/page.tsx`:

```tsx
"use client";

import { useActionState } from "react";
import { loginAction } from "@/lib/actions/auth.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, undefined);

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-xl">Sign in</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" />
          </div>
          {state?.error && (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          )}
          <Button type="submit" className="w-full" size="lg" disabled={isPending}>
            {isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create the mobile nav and desktop sidebar components**

Create `components/nav/MobileNav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, ScanLine, ShoppingCart, Package, Receipt, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/sell", label: "Sell", icon: ShoppingCart },
  { href: "/products", label: "Products", icon: Package },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/settings", label: "More", icon: MoreHorizontal },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t bg-background md:hidden">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-xs",
              active ? "text-primary" : "text-muted-foreground"
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
```

Create `components/nav/DesktopSidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  Boxes,
  ScanLine,
  ShoppingCart,
  Receipt,
  BarChart3,
  Users,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/products", label: "Products", icon: Package },
  { href: "/inventory", label: "Inventory", icon: Boxes },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/sell", label: "Sell", icon: ShoppingCart },
  { href: "/sales", label: "Sales", icon: Receipt },
  { href: "/reports", label: "Reports", icon: BarChart3 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function DesktopSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 border-r px-3 py-6 md:block">
      <nav className="flex flex-col gap-1">
        {items.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium",
                active ? "bg-muted text-primary" : "text-muted-foreground hover:bg-muted/50"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

Install the icon package: `npm install lucide-react`

- [ ] **Step 4: Create the (app) layout**

Create `app/(app)/layout.tsx`:

```tsx
import { requireUser } from "@/lib/auth/guards";
import { MobileNav } from "@/components/nav/MobileNav";
import { DesktopSidebar } from "@/components/nav/DesktopSidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar />
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
      <MobileNav />
    </div>
  );
}
```

- [ ] **Step 5: Create a dashboard stub page**

Create `app/(app)/dashboard/page.tsx`:

```tsx
import { requireUser } from "@/lib/auth/guards";

export default async function DashboardPage() {
  const user = await requireUser();

  return (
    <div className="p-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">Signed in as {user.email} ({user.role})</p>
    </div>
  );
}
```

- [ ] **Step 6: Redirect root to dashboard**

Replace `app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/dashboard");
}
```

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: build succeeds with no TypeScript/ESLint errors.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "Add login page and authenticated app shell with mobile nav"
```

---

### Task 6: Configure Vitest and run the full test suite

**Files:**
- Create: `vitest.config.ts`, `tests/setup.ts`
- Modify: `package.json` (add `test` script)

**Interfaces:**
- Produces: `npm test` runs all `tests/**/*.test.ts` files with the `@/*` path alias resolved.

- [ ] **Step 1: Install Vitest and supporting packages**

```bash
npm install -D vitest vite-tsconfig-paths
```

- [ ] **Step 2: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: false,
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script to package.json**

In `package.json`, under `"scripts"`, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Run the full test suite**

Run: `npm test`
Expected: PASS — the schema smoke test (Task 3) and guard tests (Task 4) both pass, no other failures.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Configure Vitest test runner"
```

---

### Task 7: Seed an initial admin user and manually verify the login flow

**Files:**
- Create: `scripts/seed.ts`
- Modify: `package.json` (add `db:seed` script)

**Interfaces:**
- Consumes: `db` from `@/lib/db/client`, `users` table from `@/lib/db/schema`.
- Produces: one ADMIN user in the database with a known dev password, documented in the plan's verification steps (not committed in plaintext anywhere else).

- [ ] **Step 1: Write the seed script**

Create `scripts/seed.ts`:

```typescript
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

async function main() {
  const email = "admin@example.com";
  const password = "ChangeMe123!";

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    console.log("Admin user already exists, skipping.");
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await db.insert(users).values({
    name: "Admin",
    email,
    passwordHash,
    role: "ADMIN",
    active: true,
  });

  console.log(`Seeded admin user: ${email} / ${password}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
```

Note: this script needs `tsx` to run TypeScript directly: `npm install -D tsx`. Because `dotenv/config` loads `.env` by default, invoke with an explicit path in the script command (Step 2) so it picks up `.env.local`.

- [ ] **Step 2: Add the db:seed script to package.json**

```json
"db:seed": "dotenv -e .env.local -- tsx scripts/seed.ts"
```

Install `dotenv-cli` for the `-e` flag support: `npm install -D dotenv-cli`

- [ ] **Step 3: Run the seed script**

Run: `npm run db:seed`
Expected: output `Seeded admin user: admin@example.com / ChangeMe123!`

- [ ] **Step 4: Manually verify the login flow end-to-end**

Run: `npm run dev`, then in a browser visit `http://localhost:3000`.

Expected:
1. Redirects to `/login`.
2. Enter `admin@example.com` / `ChangeMe123!`, submit.
3. Redirects to `/dashboard`, showing "Signed in as admin@example.com (ADMIN)".
4. Mobile viewport (resize browser to ~390px wide) shows the bottom nav bar with Home/Scan/Sell/Products/Sales/More.
5. Desktop viewport shows the left sidebar instead.

Stop the dev server after confirming.

- [ ] **Step 5: Document credentials in README**

Create `README.md` at repo root (or append if it exists from `create-next-app`) with a "Development" section:

```markdown
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
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Add database seed script and README development instructions"
```

---

## Phase 1 Completion Report Checklist

After all tasks are done, report per spec section 64:
1. What was implemented — scaffold, DB schema/migrations, Auth.js login, app shell/nav
2. Files changed — full list from `git log --stat`
3. Database changes — 7 tables created via `0000_init.sql`
4. Tests added — schema smoke test, guard unit tests
5. Tests executed — `npm test` output
6. Remaining issues — none expected if all steps pass; note any deviations
7. How to manually verify — steps from Task 7, Step 4
