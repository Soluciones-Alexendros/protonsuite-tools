# node:22-alpine — digest verified 2026-10-25 (Node 22 / Alpine 3.24)
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS builder
WORKDIR /app
# pnpm 12.15.0 — same major/minor as CI (setup-project → latest)
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
ENV HUSKY=0
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
RUN pnpm run build

# ---- Runtime ----
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS runtime
WORKDIR /app
ENV NODE_ENV=production
# pnpm 12.15.0 — same major/minor as CI (setup-project → latest)
RUN corepack enable && corepack prepare pnpm@12.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY --from=builder /app/dist ./dist

# Proton Drive CLI: no se descarga en build (proton.me no ofrece URL pinneable
# por digest; Scorecard Pinned-Dependencies). El operador lo instala en el host
# o en el contenedor en marcha — ver docs/drive-audit.md y ADR-006.
# El auth token del CLI se persiste en /home/node/.config/proton-drive
# (volumen `drive-auth-data` en docker-compose.yml).

# Listen on all interfaces inside the container (network policy is enforced by the reverse proxy)
ENV MCP_HTTP_HOST=0.0.0.0
ENV MCP_HTTP_PORT=8787
ENV MCP_TRANSPORT=http
ENV DRIVE_CLI_BIN=/usr/local/bin/proton-drive

EXPOSE 8787

# Simple healthcheck — relies on /healthz
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz || exit 1

CMD ["node", "dist/index.js"]
