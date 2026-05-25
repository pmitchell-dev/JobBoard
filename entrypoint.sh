#!/bin/sh
# Container already runs as jobboard (UID 1000) via Dockerfile USER directive.
# chown is best-effort — host dirs are pre-owned 1000:1000 by pi_rebuild.sh
chown -R node:node /app/data /app/cache 2>/dev/null || true
exec node server.js
