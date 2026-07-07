# Third-party source checkouts

## Plannotator

`third_party/plannotator/` is a pinned source checkout of `https://github.com/backnotprop/plannotator.git` used to prove direct reuse of upstream Plannotator UI components that are not currently published as npm packages.

The checkout is intentionally treated as reviewed third-party source:

1. Pin the exact commit in `third_party/plannotator-revision.txt`.
2. Review upstream changes before updating the checkout.
3. Keep Vite aliases package-shaped (`@plannotator/ui`, `@plannotator/shared`, etc.) so future migration to published packages is straightforward.
4. Do not disable Deno/npm freshness safety controls to force same-day package installs. Use the reviewed source checkout or a Deno-resolvable published version instead.

To update:

```sh
cd third_party/plannotator
git fetch origin main
git checkout <reviewed-commit>
git rev-parse HEAD > ../plannotator-revision.txt
```
