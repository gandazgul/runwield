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
