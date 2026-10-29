# Web image: Bun installs and runs the build; the standalone Next.js server runs on Node,
# Next.js's supported production runtime.
# Build from the repo root:  docker build -f apps/web/Dockerfile -t web .
ARG BUN_VERSION=1.3
FROM oven/bun:${BUN_VERSION}-slim AS bun

FROM node:22-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT_STANDALONE=1

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN bun install --frozen-lockfile --linker hoisted --filter '@dash/web'

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN cd apps/web && bun run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 8080
CMD ["node", "apps/web/server.js"]
