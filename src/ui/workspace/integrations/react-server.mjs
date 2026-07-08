import React from "react";
import ReactDOM from "react-dom/server";

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

export default {
    name: "@astrojs/react",
    check,
    renderToStaticMarkup,
    supportsAstroStaticSlot: true,
};
