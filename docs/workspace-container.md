# Workspace in a container

Run Workspace and the TUI in the same container, as the same user. Mount your cloned repository at a stable path and
keep RunWield's state volume. Your phone is another view of that running agent.

The repository's default `compose.yml` serves shared Plans. Use `compose.workspace.yml` for your personal Workspace and
agent runtime. It reuses the existing RunWield image with Git, Node, and the command-line helpers installed.

Build the current checkout for your container's architecture:

```sh
deno task compile --target aarch64-unknown-linux-gnu
# Use x86_64-unknown-linux-gnu on an x86 Linux host.
```

Set the repository path and the HTTPS origin supplied by your reverse proxy or private tunnel, then start Workspace:

```sh
export RUNWIELD_PROJECT_ROOT=/absolute/path/to/your/cloned-repo
export RUNWIELD_WORKSPACE_ORIGIN=https://your-private-workspace.example
docker compose -f compose.workspace.yml up --build -d
```

The service listens on host loopback port 8787 for the proxy. Open the configured origin and approve the pairing code:

```sh
docker exec runwield-workspace wld workspace pair CODE
```

Link `/workspace/project` from Workspace's Projects screen. Configure your model in the TUI, or pass your provider's API
key through the environment entries in the Compose file:

```sh
docker exec -it -w /workspace/project runwield-workspace wld
```

Use `/resume` in that TUI to continue a Session started in Workspace. You can leave it open while working from your
phone. Steering, questions, and Stop reach the agent in the container; there is no separate agent on the phone.

Keep the repository mounted at `/workspace/project` and retain the named state volume when recreating the container.
Both screens then rediscover the saved conversation. A running turn ends if the container stops; send a follow-up to
continue from saved history after restarting.

On Linux, the container's `deno` user must be able to write the mounted repository. Use the matching host ownership or
your container engine's user mapping. Podman can run the same image and Compose file.
