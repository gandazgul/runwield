# syntax=docker/dockerfile:1

FROM denoland/deno:2.9.2 AS builder
WORKDIR /app

COPY deno.json deno.lock runtime-root.js ./
COPY scripts ./scripts
COPY src ./src
COPY third_party ./third_party
COPY logo.svg ./logo.svg

RUN deno task workspace:build && deno run -A scripts/build-workspace-runtime.js
RUN deno cache src/ui/workspace/remote-server.js

FROM denoland/deno:2.9.2
WORKDIR /app

ENV RUNWIELD_REMOTE_HOST=0.0.0.0 \
    RUNWIELD_REMOTE_PORT=8080 \
    RUNWIELD_REMOTE_DB_PATH=/data/runwield-shared-spaces.sqlite

COPY --from=builder --chown=deno:deno /deno-dir /deno-dir
COPY --from=builder --chown=deno:deno /app/deno.json /app/deno.lock /app/runtime-root.js ./
COPY --from=builder --chown=deno:deno /app/src ./src
COPY --from=builder --chown=deno:deno /app/dist/workspace-runtime ./dist/workspace-runtime
COPY --from=builder --chown=deno:deno /app/logo.svg ./logo.svg

RUN mkdir -p /data && chown -R deno:deno /data /app
USER deno
EXPOSE 8080
VOLUME ["/data"]

CMD ["run", "--allow-read=/app,/data", "--allow-write=/data", "--allow-net", "--allow-env", "--allow-sys", "src/ui/workspace/remote-server.js"]
