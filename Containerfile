FROM denoland/deno:2.9.3 AS builder
WORKDIR /app

COPY deno.json deno.lock runtime-root.js ./
COPY scripts ./scripts
COPY src ./src
COPY third_party ./third_party
COPY logo.svg ./logo.svg

RUN deno task workspace:remote:build

FROM denoland/deno:2.9.3
WORKDIR /app

ENV RUNWIELD_REMOTE_HOST=0.0.0.0 \
    RUNWIELD_REMOTE_PORT=8080 \
    RUNWIELD_REMOTE_DB_PATH=/data/runwield-shared-spaces.sqlite \
    RUNWIELD_REMOTE_MAX_REQUEST_BYTES=5242880

COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app/dist/plan-server/ ./

RUN mkdir -p /data && chown -R deno:deno /data /app
USER deno
EXPOSE 8080
VOLUME ["/data"]

CMD ["run", "--cached-only", "--allow-read=/app,/data", "--allow-write=/data", "--allow-net", "--allow-env", "--allow-sys", "remote-server.js"]
