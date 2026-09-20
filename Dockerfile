# syntax=docker/dockerfile:1

FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next build statically analyzes API routes, which imports lib/db/client.ts.
# That file requires DATABASE_URL to construct a Pool at module load time.
# Railway only injects real env vars into the running container, not the
# build step, so this placeholder exists purely to satisfy that import
# during the build — no connection is ever attempted at build time, and
# the real DATABASE_URL from Railway takes over the moment the container starts.
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server output + static assets
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Next's file tracer misses drizzle-orm's node-postgres subpath export,
# so it's absent from .next/standalone/node_modules despite being a real
# runtime dependency of lib/db/client.ts — copy it explicitly or the
# container crashes on first request.
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
COPY --from=builder /app/node_modules/@drizzle-team ./node_modules/@drizzle-team

# drizzle-kit + its config/migrations are needed at runtime for the
# migrate-then-start startup command (see start:prod). drizzle.config.ts
# imports dotenv unconditionally (harmless no-op in production, where
# .env.local doesn't exist and DATABASE_URL comes from Railway instead).
COPY --from=builder /app/node_modules/drizzle-kit ./node_modules/drizzle-kit
COPY --from=builder /app/node_modules/.bin/drizzle-kit ./node_modules/.bin/drizzle-kit
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npm", "run", "start:prod"]
