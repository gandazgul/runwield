import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, m as maybeRenderHead } from '../chunks/astro/server_CySqi4lW.mjs';
import { l as loadCanonicalBoard, s as serializeCanonicalPlanError, $ as $$WorkspaceLayout } from '../chunks/astro-canonical-data_DtpUFPWi.mjs';
import { P as PlanBoard } from '../chunks/Board_DjpQ8F6W.mjs';
export { renderers } from '../renderers.mjs';

const $$Astro = createAstro();
const $$Index = createComponent(async ($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Index;
  const runtime = globalThis;
  const workspaceCwd = Astro2.request.headers.get("x-runwield-workspace-cwd") || runtime.Deno?.cwd?.() || ".";
  let board = null;
  let error = null;
  try {
    board = await loadCanonicalBoard(workspaceCwd);
  } catch (caught) {
    error = await serializeCanonicalPlanError(caught);
    Astro2.response.status = 409;
  }
  return renderTemplate`${renderComponent($$result, "WorkspaceLayout", $$WorkspaceLayout, { "title": "RunWield Workspace", "selectedTab": "active", "url": Astro2.url.href }, { "default": async ($$result2) => renderTemplate`${error ? renderTemplate`${maybeRenderHead()}<section class="error-panel"> <h2>Plan Board failed to load</h2> <p>${error.error}</p> <p>${error.repair}</p> </section>` : renderTemplate`${renderComponent($$result2, "PlanBoard", PlanBoard, { "board": board, "view": "active", "url": Astro2.url.href, "client:load": true, "client:component-hydration": "load", "client:component-path": "/Users/gandazgul/Documents/web/harns/src/ui/workspace/components/Board.jsx", "client:component-export": "PlanBoard" })}`}` })}`;
}, "/Users/gandazgul/Documents/web/harns/src/ui/workspace/pages/index.astro", void 0);

const $$file = "/Users/gandazgul/Documents/web/harns/src/ui/workspace/pages/index.astro";
const $$url = "";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    default: $$Index,
    file: $$file,
    url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
