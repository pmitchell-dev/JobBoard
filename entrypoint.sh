#!/bin/sh
# Fix ownership of bind-mounted volumes (host may own them as root)
chown -R jobboard:jobboard /app/data /app/cache 2>/dev/null || true
# Drop to non-root user and start the server
exec su-exec jobboard node server.js
