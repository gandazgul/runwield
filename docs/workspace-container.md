# Workspace in a container

Run personal Workspace and its agents in one container. This is not the shared Plan server in the root `Containerfile`.
Use Podman. The Kubernetes example is not connected to Flux and does not deploy anything.

## Build

From this checkout, compile for the Linux server architecture, then build the `wld-workspace` target:

```sh
deno task compile --target x86_64-unknown-linux-gnu
podman build --platform linux/amd64 --target wld-workspace \
  -f Containerfile.wld-ux -t localhost/runwield-workspace:local .
```

For ARM64, use `aarch64-unknown-linux-gnu` and `--platform linux/arm64`. Also set `RUNWIELD_PLATFORM=linux/arm64` for
Compose. The binary and image architectures must match. The image includes Git and Node and uses the checked-in
installer for RunWield helpers. It needs network access. Helpers follow current installer releases; rebuild to update
them. Add project-specific build tools to a derived image if needed.

## Persistent folders

The image runs as `deno`, UID/GID **1993**, with `HOME=/home/deno`.

| Container path       | Contents                                                                              |
| -------------------- | ------------------------------------------------------------------------------------- |
| `/workspace/project` | Your projects folder; put each cloned repository in a child directory.                |
| `/home/deno/.wld`    | RunWield settings, credentials, Sessions, device pairing, and Workspace registration. |
| `/home/deno/.agents` | Your shared agent skills and configuration.                                           |

Memory uses `/home/deno/.wld/mnemoteca.db` through `MNEMOTECA_DB_PATH`, so it needs no fourth mount. Keep these paths
stable: registered Projects and saved work can contain absolute paths. Mount only data you trust this agent to access.
Do not share the same state folders between independently running Workspace containers. Back up all three folders while
Workspace is stopped. A restart preserves saved work, not an active agent turn.

For Linux bind mounts, grant UID/GID 1993 write access to the three folders. With rootless Podman, use a matching user
mapping or prepare ownership through `podman unshare`. Do not recursively change ownership of your own home directory.
On SELinux hosts, use the appropriate volume labels (`:Z` for private folders).

**Existing Compose users:** the previous example used named state and memory volumes. Stop it and copy that data into
your chosen folders before switching. Copy the old memory database to `.wld/mnemoteca.db`. Keep the original volumes
until you verify the migration. Existing single-repository mounts at `/workspace/project` remain supported.

## Run with Podman

Set an HTTPS origin served by your private reverse proxy or tunnel. HTTP inside the container is for that trusted proxy
only. Do not expose port 8787 directly to the internet.

```sh
export RUNWIELD_PROJECT_ROOT=/absolute/path/to/projects
export RUNWIELD_STATE_ROOT=/absolute/path/to/workspace-state
export RUNWIELD_AGENTS_ROOT=/absolute/path/to/agents
export RUNWIELD_WORKSPACE_ORIGIN=https://your-private-workspace.example

podman run -d --name runwield-workspace --init \
  -p 127.0.0.1:8787:8787 \
  -e RUNWIELD_WORKSPACE_ORIGIN -e ANTHROPIC_API_KEY -e OPENAI_API_KEY -e GOOGLE_API_KEY \
  -v "$RUNWIELD_PROJECT_ROOT:/workspace/project" \
  -v "$RUNWIELD_STATE_ROOT:/home/deno/.wld" \
  -v "$RUNWIELD_AGENTS_ROOT:/home/deno/.agents" \
  localhost/runwield-workspace:local
```

Create the folders and set their permissions first. Alternatively, with a Compose provider installed:

```sh
podman compose -f compose.workspace.yml up --build -d
```

Open the configured HTTPS origin and approve the pairing code:

```sh
podman exec runwield-workspace wld workspace pair CODE
```

Link each repository, such as `/workspace/project/my-app`, from Workspace's Projects screen. Configure your model in the
TUI or pass provider keys through environment variables. Git identity and Git credentials must also be configured for
repository publication; they are not included in the image. Do not bake secrets into image layers.

```sh
podman exec -it -w /workspace/project/my-app runwield-workspace wld
```

Use `/resume` to continue a saved Session. Workspace and the TUI use the same container user and state. The image
accepts explicit CLI commands too, for example `podman run --rm localhost/runwield-workspace:local --version`.

## Kubernetes preparation — no deployment

The [Kubernetes example](../packaging/workspace/kubernetes/workspace.yaml) follows `k8s-infrastructure` settings:
`hostpath` storage, NGINX ingress, and the `internal-ingress-cert` TLS secret. It uses three separate persistent claims,
one replica, and `Recreate` updates to avoid two servers writing the same state. No service-account token is mounted.
The root filesystem remains writable because agents run development tools and install project dependencies.

Before deployment, which is a separate step:

1. Publish the tested image to your registry and replace the example image tag with an immutable tag or digest. No image
   is pushed by the build command above.
2. Set the same private HTTPS hostname in `RUNWIELD_WORKSPACE_ORIGIN`, the Ingress rule, and its TLS hosts. Ensure the
   TLS certificate covers it. Keep access private through your network or ingress policy.
3. Review storage sizes and placement. The example requests new claims; to use existing data, change the claim names or
   use your existing PVC with separate `subPath` folders. The node must hold all required hostpath data. Hostpath
   storage is not a backup or automatic failover.
4. Ensure the folders are writable by UID/GID 1993. `fsGroup` is included, but not all hostpath drivers apply ownership.
   Prepare host folders explicitly if your provisioner does not.
5. Add provider credentials using your Sealed Secrets process, or configure authentication in the mounted `.wld` folder.
   Do not commit credentials. Supply Git configuration and credentials separately if agents must push changes.
6. Adjust resources for the projects. The example selects `amd64`; change this for an ARM64 image.

Render locally without contacting Kubernetes:

```sh
kustomize build packaging/workspace/kubernetes
```

After a separately approved deployment, approve browser pairing from the running Pod:

```sh
kubectl exec deployment/runwield-workspace -- wld workspace pair CODE
```

The example is intentionally outside `../k8s-infrastructure` and its Flux resource lists. Do not add it there until you
are ready to deploy.
