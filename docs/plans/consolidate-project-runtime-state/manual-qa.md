# Manual QA for consolidate-project-runtime-state

This checklist is advisory. It does not change RunWield verification status.

<!-- runwield:manual-qa:start child="consolidate-project-runtime-state/01-add-runtime-layout-contract" -->

## Add Runtime Layout Contract

Manual verification steps for consolidate-project-runtime-state/01-add-runtime-layout-contract

- [ ] Review the runtime layout output and confirm that primary and selected checkouts use separate `.wld/internal`
      roots with the documented leaf names.
- [ ] Review Git safety output and confirm that current runtime paths and bounded legacy hazard paths are protected,
      while `.wld/settings.json`, `.wld/agents/**`, `.wld/skills/**`, and `.wld/prompts/**` are not protected.
- [ ] Confirm that existing production runtime files remain in their current locations and that no migration, writer
      cutover, or `.gitignore` reconciliation is presented as active.
- [ ] Review the domain glossary and confirm that it defines the four runtime terms without claiming migration or writer
      cutover.

<!-- runwield:manual-qa:end child="consolidate-project-runtime-state/01-add-runtime-layout-contract" -->

<!-- runwield:manual-qa:start child="consolidate-project-runtime-state/02-add-legacy-runtime-migration-engine" -->

## Add Legacy Runtime Migration Engine

Manual verification steps for consolidate-project-runtime-state/02-add-legacy-runtime-migration-engine

- [ ] Run migration on a disposable repository with a primary checkout and a linked checkout. Confirm legacy runtime
      files move to the matching internal roots, and their content and permissions stay unchanged.
- [ ] Run migration a second time. Confirm it reports no new migration and does not change files, directories, or the
      completed layout marker.
- [ ] Repeat with an active legacy writer, tracked runtime path, symlink, malformed registry, or unfinished publication.
      Confirm migration is blocked and the original files remain unchanged.
- [ ] Stop migration during an adoption step, restart it, and confirm it safely completes or reports a blocker without
      losing or overwriting source or destination data.

<!-- runwield:manual-qa:end child="consolidate-project-runtime-state/02-add-legacy-runtime-migration-engine" -->
