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

# Next's standalone tracer only includes what the Next.js server itself
# needs at runtime, not drizzle-kit's CLI (used by start:prod to run
# migrations) or drizzle-orm/node-postgres (a subpath export the tracer
# misses despite it being a real runtime dependency of lib/db/client.ts).
# Rather than hand-pick individual packages out of node_modules and risk
# missing a transitive dependency (drizzle-kit alone pulls in esbuild,
# @esbuild-kit/esm-loader, and tsx), copy the complete node_modules that
# `npm ci` already resolved correctly in the deps stage.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/package.json ./package.json

RUN chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["npm", "run", "start:prod"]
