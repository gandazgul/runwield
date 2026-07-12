import { e as createComponent, g as addAttribute, l as renderHead, n as renderSlot, r as renderTemplate, h as createAstro } from './astro/server_CySqi4lW.mjs';
import 'clsx';

const $$Astro = createAstro();
const $$ReviewLayout = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$ReviewLayout;
  const { title = "RunWield Review" } = Astro2.props;
  return renderTemplate`<html lang="en"> <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="generator"${addAttribute(Astro2.generator, "content")}><title>${title}</title><link rel="icon" href="/logo.svg" type="image/svg+xml"><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/components.css"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/theme.css">${renderHead()}</head> <body> <main class="review-shell" data-astro-review-shell> ${renderSlot($$result, $$slots["default"])} </main> </body></html>`;
}, "/Users/gandazgul/Documents/web/harns/src/ui/workspace/layouts/ReviewLayout.astro", void 0);

export { $$ReviewLayout as $ };
