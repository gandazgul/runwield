// @ts-nocheck: shim for @plannotator/web-highlighter in Workspace review builds.

export default class Highlighter {
    static event = { CREATE: "CREATE", CLICK: "CLICK" };
    constructor() {
        this.handlers = new Map();
    }
    on(event, handler) {
        this.handlers.set(event, handler);
    }
    run() {}
    dispose() {}
    getDoms() {
        return [];
    }
    addClass() {}
    remove() {}
    fromStore() {
        return null;
    }
    fromRange() {
        return null;
    }
}
