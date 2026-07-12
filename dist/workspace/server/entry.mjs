import { renderers } from './renderers.mjs';
import { c as createExports, s as serverEntrypointModule } from './chunks/_@astrojs-ssr-adapter_DpnF-QB8.mjs';
import { manifest } from './manifest_CPpbrsfM.mjs';

const serverIslandMap = new Map();;

const _page0 = () => import('./pages/_image.astro.mjs');
const _page1 = () => import('./pages/closed.astro.mjs');
const _page2 = () => import('./pages/components.css.astro.mjs');
const _page3 = () => import('./pages/dev/code-review.astro.mjs');
const _page4 = () => import('./pages/dev/plan-review.astro.mjs');
const _page5 = () => import('./pages/logo.svg.astro.mjs');
const _page6 = () => import('./pages/on-hold.astro.mjs');
const _page7 = () => import('./pages/plans/_planid_.astro.mjs');
const _page8 = () => import('./pages/review/code.astro.mjs');
const _page9 = () => import('./pages/review/plan.astro.mjs');
const _page10 = () => import('./pages/theme.css.astro.mjs');
const _page11 = () => import('./pages/tokens.css.astro.mjs');
const _page12 = () => import('./pages/index.astro.mjs');
const pageMap = new Map([
    ["../../../node_modules/.deno/astro@5.18.2/node_modules/astro/dist/assets/endpoint/generic.js", _page0],
    ["pages/closed.astro", _page1],
    ["pages/components.css.js", _page2],
    ["pages/dev/code-review.astro", _page3],
    ["pages/dev/plan-review.astro", _page4],
    ["pages/logo.svg.js", _page5],
    ["pages/on-hold.astro", _page6],
    ["pages/plans/[planId].astro", _page7],
    ["pages/review/code.astro", _page8],
    ["pages/review/plan.astro", _page9],
    ["pages/theme.css.js", _page10],
    ["pages/tokens.css.js", _page11],
    ["pages/index.astro", _page12]
]);

const _manifest = Object.assign(manifest, {
    pageMap,
    serverIslandMap,
    renderers,
    actions: () => import('./noop-entrypoint.mjs'),
    middleware: () => import('./_noop-middleware.mjs')
});
const _args = {
    "start": false,
    "relativeClientPath": "../../client/"
};
const _exports = createExports(_manifest, _args);
const stop = _exports['stop'];
const handle = _exports['handle'];
const start = _exports['start'];
const running = _exports['running'];
const _start = 'start';
if (Object.prototype.hasOwnProperty.call(serverEntrypointModule, _start)) {
	serverEntrypointModule[_start](_manifest, _args);
}

export { handle, pageMap, running, start, stop };
