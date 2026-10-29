# API image: Bun runs the TypeScript directly — no build step.
# Build from the repo root:  docker build -f apps/api/Dockerfile -t api .
# Keep BUN_VERSION in line with `bun --version` on your machine (same value in apps/web/Dockerfile).
ARG BUN_VERSION=1.3
FROM oven/bun:${BUN_VERSION}-slim

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first (cached until a package.json or bun.lock changes). Only the API's production
# dependencies are installed; the hoisted layout is a plain node_modules folder.
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --production --linker hoisted --filter '@dash/api' \
  && rm -rf /root/.bun/install/cache

COPY packages/shared packages/shared
COPY apps/api/src apps/api/src
COPY apps/api/drizzle apps/api/drizzle

WORKDIR /app/apps/api
USER bun
ENV PORT=8080
EXPOSE 8080
# The migrate job uses the same image with: bun src/db/migrate.ts
CMD ["bun", "src/index.ts"]
