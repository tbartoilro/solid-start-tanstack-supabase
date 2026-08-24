# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:24-slim AS build

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
#
# --ignore-scripts is required, not incidental: the `prepare` script runs
# `panda codegen`, which needs panda.config.ts — and at this layer only
# package.json has been copied. Codegen runs after the source is in place.
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .

# Generates styled-system/, which the build imports.
RUN npx panda codegen

# VITE_-prefixed values are inlined into the client bundle at build time, so
# they must be present *now* rather than at boot. They are publishable by
# definition — every table is behind RLS — so passing them as build args is
# safe. SUPABASE_SECRET_KEY deliberately is NOT here: it is read from the
# process environment at runtime and must never reach a layer or the bundle.
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN npm run build

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Nitro emits a self-contained server bundle, so no node_modules is needed.
COPY --from=build /app/.output ./.output

# Drops root before running the server.
USER node

EXPOSE 3000

# src/server/env.ts validates at module load, so a missing SUPABASE_SECRET_KEY
# fails the container immediately and loudly rather than at first request.
CMD ["node", ".output/server/index.mjs"]
