# syntax = docker/dockerfile:1

# Base stage with bun
FROM oven/bun:1.2.20-alpine AS base
WORKDIR /app

# Install dependencies stage
FROM base AS deps
COPY package.json turbo.json ./
COPY apps/web/package.json ./apps/web/
# Web depends on @aequi/core via workspace alias for SETTLER_META_TXN_ABI
# (Permit2 client-side re-encoding). Without core's package.json in the deps
# install, the workspace symlink would dangle.
COPY packages/core/package.json ./packages/core/
RUN bun install

# Build stage
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY turbo.json ./
COPY package.json ./
# Vite resolves @aequi/core via the workspace src tree; ship the whole package.
COPY packages/core ./packages/core
COPY apps/web ./apps/web

# Build core first so dist exists if @aequi/core's package.json declares a
# dist entrypoint. Most Vite configs resolve from src/, but this is a safe
# belt-and-braces step.
RUN cd packages/core && bun run build || true

ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

WORKDIR /app/apps/web

# Build with verbose output
RUN echo "=== Starting Vite build ===" && \
    echo "API URL: $VITE_API_BASE_URL" && \
    bun vite build && \
    echo "=== Build complete ===" && \
    echo "=== Dist folder contents ===" && \
    ls -laR dist/ && \
    echo "=== index.html content ===" && \
    if [ -f dist/index.html ]; then cat dist/index.html; else echo "ERROR: index.html not found!"; exit 1; fi

# Production stage with nginx
FROM nginx:alpine AS runner

# Remove default nginx config and files
RUN rm -rf /etc/nginx/conf.d/* && rm -rf /usr/share/nginx/html/*

# Copy built assets
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

# Verify files after copy
RUN echo "=== Nginx html folder contents ===" && \
    ls -laR /usr/share/nginx/html/ && \
    if [ ! -f /usr/share/nginx/html/index.html ]; then echo "ERROR: index.html missing in nginx!"; exit 1; fi

# Copy nginx config with security headers
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
