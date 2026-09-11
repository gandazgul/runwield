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

<!-- runwield:manual-qa:start child="consolidate-project-runtime-state/03-move-primary-runtime-stores" -->

## Move Primary Runtime Stores

Manual verification steps for consolidate-project-runtime-state/03-move-primary-runtime-stores

- [ ] In disposable primary and linked checkouts, write and update registry and controller data from both checkouts.
      Confirm both use the primary `.wld/internal/` files and no duplicate legacy or linked-checkout stores appear.
- [ ] Hold the primary registry lock, attempt a linked-checkout update, and confirm the update waits until the lock is
      released.
- [ ] Start a real publication from a linked checkout. Confirm the staging checkout is under primary
      `.wld/internal/plan-staging/<attempt>` and the target contains the validated commit.
- [ ] Retry an existing publication with recorded absolute staging and repair paths. Confirm the same paths are used and
      cleanup removes them only after successful publication.
- [ ] Run with `HOME` absent from both checkouts. Confirm the fallback worktree path is primary
      `.wld/internal/worktrees/`; also confirm a configured override and normal home-based path remain unchanged.
- [ ] Create an unresolved registry identity and confirm its migration report is written only under the primary internal
      report path.

<!-- runwield:manual-qa:end child="consolidate-project-runtime-state/03-move-primary-runtime-stores" -->

<!-- runwield:manual-qa:start child="consolidate-project-runtime-state/04-move-selected-checkout-runtime-stores" -->

## Move Selected-Checkout Runtime Stores

Manual verification steps for consolidate-project-runtime-state/04-move-selected-checkout-runtime-stores

- [ ] Hold a Plan or catalog lock in a selected checkout and verify its file is below `.wld/internal/plan-locks`; verify
      a second task waits, a different checkout remains usable, and no legacy lock appears.
- [ ] Pause a real transition and verify its journal is below the selected checkout's `.wld/internal/plan-transitions`;
      verify success removes it and rollback or uncertain recovery preserves the correct record.
- [ ] Run Doctor and Plan Recovery with settled and uncertain journals in a registered worktree; verify only settled
      records are removed and attested records stay in that worktree's `attested/` directory.
- [ ] Hold each Work Record supersession and recovery lock in a selected checkout; verify the protected operation cannot
      change documents, then verify it succeeds after release and creates no legacy lock.
- [ ] Verify controller and registry files remain in the primary checkout while selected locks and journals remain local
      to the selected checkout.
- [ ] Seed legacy runtime files in a disposable fixture and verify migration retains their bytes at the new selected
      paths and refuses live legacy locks without moving authority.

<!-- runwield:manual-qa:end child="consolidate-project-runtime-state/04-move-selected-checkout-runtime-stores" -->
