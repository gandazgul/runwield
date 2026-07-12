import React from 'react';
import ReactDOM from 'react-dom/server.browser';

const REACT_ELEMENT_SYMBOLS = new Set([
    Symbol.for("react.element"),
    Symbol.for("react.transitional.element"),
]);

function check(Component, props, children) {
    if (typeof Component === "object") {
        return REACT_ELEMENT_SYMBOLS.has(Component?.$$typeof);
    }
    if (typeof Component !== "function") return false;
    if (Component.prototype != null && typeof Component.prototype.render === "function") {
        return Object.prototype.isPrototypeOf.call(React.Component, Component) ||
            Object.prototype.isPrototypeOf.call(React.PureComponent, Component);
    }
    try {
        const vnode = Component(props ?? {}, children ?? {});
        return REACT_ELEMENT_SYMBOLS.has(vnode?.$$typeof);
    } catch {
        return true;
    }
}

function renderToStaticMarkup(Component, props) {
    const vnode = React.createElement(Component, props ?? {});
    const html = ReactDOM.renderToString(vnode);
    return { html, attrs: {} };
}

const _renderer0 = {
    name: "@astrojs/react",
    check,
    renderToStaticMarkup,
    supportsAstroStaticSlot: true,
};

const renderers = [Object.assign({"name":"@astrojs/react","clientEntrypoint":"@astrojs/react/client.js","serverEntrypoint":"file:///Users/gandazgul/Documents/web/harns/src/ui/workspace/integrations/react-server.mjs"}, { ssr: _renderer0 }),];

export { renderers };
