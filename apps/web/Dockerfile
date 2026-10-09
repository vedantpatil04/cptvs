# syntax=docker/dockerfile:1
# CPVTS web image (static build served by nginx). Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=https://api.example.com -t cpvts-web .
# VITE_* values are embedded at build time.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @cpvts/shared --workspace @cpvts/web --include-workspace-root=false

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web

ARG VITE_API_BASE_URL
ARG VITE_API_URL
ARG VITE_BRAND_SHORT_NAME
ARG VITE_BRAND_PRODUCT_NAME
ARG VITE_BRAND_INSTITUTION_NAME
ARG VITE_BRAND_SHOW_DEMO_NOTICE
ARG VITE_DEFAULT_LOCALE
RUN npm run build -w @cpvts/shared && npm run build -w @cpvts/web

FROM nginx:1.29-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
