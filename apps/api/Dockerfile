# Build from the repository root.
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install -g bun@1.4.4
COPY package.json bun.lock ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/payments/package.json ./packages/payments/package.json

FROM dependencies AS builder
RUN bun install --frozen-lockfile --filter api
COPY apps/api ./apps/api
RUN cd apps/api && bun run build

FROM dependencies AS production-dependencies
RUN bun install --frozen-lockfile --production --filter api \
    && mkdir -p apps/api/node_modules

FROM node:22-bookworm-slim AS runtime
ARG BILLING_REVISION=local
LABEL org.opencontainers.image.revision=$BILLING_REVISION
ENV NODE_ENV=production PORT=3015
WORKDIR /app/apps/api
COPY --from=production-dependencies /app/node_modules /app/node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./node_modules
COPY --from=builder /app/apps/api/dist ./dist
COPY apps/api/package.json ./package.json
USER node
EXPOSE 3015
CMD ["node", "dist/src/main.js"]
