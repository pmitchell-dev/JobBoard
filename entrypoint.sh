#!/bin/sh
# entrypoint.sh runs as root to dynamically fix volume permissions.

# Get the UID and GID of the host-mounted /app/data directory
HOST_UID=$(stat -c "%u" /app/data)
HOST_GID=$(stat -c "%g" /app/data)

# If they don't match the node user's current UID/GID, update the node user
if [ "$HOST_UID" != "0" ] && [ "$HOST_UID" != "$(id -u node)" ]; then
    usermod -o -u "$HOST_UID" node
fi
if [ "$HOST_GID" != "0" ] && [ "$HOST_GID" != "$(id -g node)" ]; then
    groupmod -o -g "$HOST_GID" node
fi

# Ensure permissions are correct
chown -R node:node /app/data /app/cache 2>/dev/null || true

# Execute the application as the node user
exec runuser -u node -- node server.js
