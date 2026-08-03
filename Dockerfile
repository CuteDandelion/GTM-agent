FROM node:22.22.2-bookworm-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY apps/prototype/package.json apps/prototype/package.json
COPY packages/agents/package.json packages/agents/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/crawler/package.json packages/crawler/package.json
COPY packages/documents/package.json packages/documents/package.json
COPY packages/orchestration/package.json packages/orchestration/package.json
COPY packages/tools/package.json packages/tools/package.json

RUN npm ci --workspace @gtm/api --include-workspace-root --omit=dev

FROM node:22.22.2-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV XDG_DATA_HOME=/tmp/opencode-data
ENV XDG_CACHE_HOME=/tmp/opencode-cache
ENV XDG_CONFIG_HOME=/tmp/opencode-config
ENV XDG_STATE_HOME=/tmp/opencode-state
ENV npm_config_cache=/tmp/npm-cache
ENV PATH=/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=dependencies /app/apps ./apps
COPY --from=dependencies /app/packages ./packages
COPY package.json package-lock.json ./
COPY apps/api ./apps/api
COPY packages ./packages

USER node

EXPOSE 3000

CMD ["./node_modules/.bin/tsx", "apps/api/src/main.ts"]
