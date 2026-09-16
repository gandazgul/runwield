---
name: wizard
description: "Generate an interactive terminal wizard for manual steps an agent cannot do: external account setup, credentials, CI secrets, dashboard configuration, one-off migrations, or cutovers. Use only when a human must act outside the repo."
license: MIT; complete terms in LICENSE
license_details: This complete `src/skills/wizard/` Skill package is licensed under MIT; see `LICENSE`. It is
    adapted from Matt Pocock's skills repository at `https://github.com/mattpocock/skills/`. This nested license
    covers only this Skill package and does not change the root RunWield license or any other repository path.
---

# Wizard

A wizard is an interactive bash script that walks a human through manual work an agent cannot do: external account
setup, credential creation, CI secret entry, dashboard configuration, one-off migrations, or cutovers. It opens each
URL, tells the human what to click, captures values in the terminal, writes them where they belong, and shows what
remains.

Use this skill only for external or human-only work. Do not use it for work the agent can perform with normal tools, and
do not use it to expose RunWield-owned repair steps to users.

Wizards run in a terminal. In Workspace or another browser surface, create the script and tell the user to run it from a
local terminal in the project root.

The wizard UX is in [`template.sh`](template.sh): stages, confirmation gates, cross-platform URL opening, hidden secret
entry, idempotent `.env` upserts, GitHub secret/variable writes, and a closing summary. Do not edit the library above
the `STAGES` marker. Author only the stages below it.

## Process

### 1. Scope the procedure

Read the repo before asking the user. For setup, inspect `.env`, `.env.example`, `.env.*`, README files,
`docker-compose*`, framework config, and `.github/workflows/*`. Each `secrets.*` or `vars.*` reference is a value the
wizard may need to produce. For a migration or cutover, identify the current state, target state, and irreversible
steps.

Then show the user the ordered stages and each captured value. For each value, know where the human gets it, where it is
written (`.env`, GitHub secret, GitHub variable, both, or nowhere), and whether it is secret.

Done when every stage and value has a source, destination, and secrecy classification.

### 2. Map each stage

For each stage, write the exact human path: URL, dashboard path, action, copied value, and target variable. If you do
not know the current UI or command, check documentation or ask. Do not invent dashboard steps.

Done when a stranger can follow each stage.

### 3. Author the wizard

Copy `template.sh` to the target path. Replace the example stage with one `stage` per manual step. Set `TOTAL_STAGES` to
the number of stages.

Use the helpers: `banner`, `stage`, `say`, `step`, `note`, `warn`, `open_url`, `ask`, `ask_secret`, `write_env`,
`set_secret`, `set_var`, `pause`, `confirm`, and `finish`.

Rules:

- Capture secrets only with `ask_secret`. Do not ask the user to paste secrets into chat.
- Persist values with `write_env`; it quotes values safely for `.env` files.
- Use `set_secret` only for values actually referenced as GitHub Actions secrets.
- Use `set_var` only for non-secret GitHub Actions variables.
- Open the relevant URL before asking for a copied value.
- Put `confirm` before irreversible actions.
- Keep each stage to one focused task so the cleared terminal stays useful.

Done when every scoped value is captured and written to its planned destination.

### 4. Verify and hand off

Run:

```bash
bash -n <script>
chmod +x <script>
```

Run `shellcheck <script>` if available.

Do not run the wizard end to end yourself. It opens browsers and waits for human input. Instead, trace it statically:
every value from step 1 is captured, every destination matches the scope, and every `set_secret` name matches a
`secrets.*` reference in CI.

Tell the user how to run it. If it is a repeatable setup path that should live in the repo, link it from setup docs.
