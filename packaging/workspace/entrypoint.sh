#!/bin/sh
set -eu

# Explicit commands also support the TUI and administrative CLI operations.
if [ "$#" -gt 0 ]; then
    exec wld "$@"
fi

: "${RUNWIELD_WORKSPACE_ORIGIN:?Set the HTTPS origin of your trusted reverse proxy}"
case "$RUNWIELD_WORKSPACE_ORIGIN" in
    https://*) ;;
    *) echo "RUNWIELD_WORKSPACE_ORIGIN must use https://" >&2; exit 1 ;;
esac

exec wld workspace serve --bind 0.0.0.0 --port 8787 \
    --public-origin "$RUNWIELD_WORKSPACE_ORIGIN" --trust-tls-terminator --no-open
