import { e as createComponent, k as renderComponent, r as renderTemplate, h as createAstro, u as unescapeHTML } from '../../chunks/astro/server_CySqi4lW.mjs';
import { $ as $$ReviewLayout } from '../../chunks/ReviewLayout_DgeqPQQn.mjs';
export { renderers } from '../../renderers.mjs';

var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(cooked.slice()) }));
var _a;
const $$Astro = createAstro();
const $$Plan = createComponent(($$result, $$props, $$slots) => {
  const Astro2 = $$result.createAstro($$Astro, $$props, $$slots);
  Astro2.self = $$Plan;
  const payloadHeader = Astro2.request.headers.get("x-runwield-review-payload") || "";
  let payload = null;
  try {
    payload = payloadHeader ? JSON.parse(payloadHeader) : null;
  } catch {
    payload = null;
  }
  if (!payload) {
    return new Response("Review token required.", { status: 401 });
  }
  return renderTemplate`${renderComponent($$result, "ReviewLayout", $$ReviewLayout, { "title": "Plan Review \xB7 RunWield Workspace" }, { "default": ($$result2) => renderTemplate(_a || (_a = __template([' <script type="application/json" data-review-payload>', "<\/script> ", " "])), unescapeHTML(JSON.stringify(payload)), renderComponent($$result2, "PlanReviewSurface", null, { "payload": payload, "client:only": "react", "client:component-hydration": "only", "client:component-path": "/Users/gandazgul/Documents/web/harns/src/ui/workspace/react/PlanReviewSurface.tsx", "client:component-export": "PlanReviewSurface" })) })}`;
}, "/Users/gandazgul/Documents/web/harns/src/ui/workspace/pages/review/plan.astro", void 0);

const $$file = "/Users/gandazgul/Documents/web/harns/src/ui/workspace/pages/review/plan.astro";
const $$url = "/review/plan";

const _page = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
    __proto__: null,
    default: $$Plan,
    file: $$file,
    url: $$url
}, Symbol.toStringTag, { value: 'Module' }));

const page = () => _page;

export { page };
