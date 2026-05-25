# ── JobBoard — Dockerfile ─────────────────────────────────────────────────────
# Node 20 slim (Debian Bookworm) — small footprint, glibc for Chromium
FROM node:20-slim

# ── System Chromium + all required shared libs for headless Chrome ─────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnspr4 \
      libnss3 \
      libx11-xcb1 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxrandr2 \
      libxshmfence1 \
      xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# ── Tell Puppeteer to skip bundled Chromium download and use the system one ────
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# ── Install production dependencies first (layer-cache friendly) ───────────────
COPY package*.json ./
RUN npm install --omit=dev

# ── Copy application source ───────────────────────────────────────────────────
COPY public/    ./public/
COPY server.js  ./

# ── Seed data files (overwritten at runtime via bind-mount in docker-compose) ──
COPY data/      ./data/

# ── Ensure writable runtime directories exist ─────────────────────────────────
RUN mkdir -p cache data/backups

# ── Copy entrypoint (fixes bind-mount ownership at startup) ───────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# ── Run as non-root for security ──────────────────────────────────────────────
# node:20-slim ships with a built-in 'node' user at UID/GID 1000 — use it directly.
RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/jobs', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/entrypoint.sh"]
