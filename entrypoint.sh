#!/bin/sh
# entrypoint.sh runs as root to dynamically fix volume permissions.

# Get the UID and GID of the host-mounted /app/data directory
HOST_UID=$(stat -c "%u" /app/data)
HOST_GID=$(stat -c "%g" /app/data)

if [ "$HOST_UID" = "0" ]; then
    # Running in Docker Desktop on Windows/Mac, or host folder is owned by root.
    # Safe to run as root to avoid EACCES since Docker Desktop masks permissions.
    echo "[Init] Docker Desktop / Root mount detected. Running as root."
    exec node server.js
else
    # Running on Linux host. Map node user to the host's UID/GID.
    echo "[Init] Linux host mount detected. Mapping node user to $HOST_UID:$HOST_GID."
    if [ "$HOST_UID" != "$(id -u node)" ]; then
        usermod -o -u "$HOST_UID" node
    fi
    if [ "$HOST_GID" != "$(id -g node)" ]; then
        groupmod -o -g "$HOST_GID" node
    fi

    # Ensure permissions are correct
    chown -R node:node /app/data /app/cache 2>/dev/null || true

    # Execute the application as the node user
    exec runuser -u node -- node server.js
fi
