// @ts-nocheck: this browser-only Vite entry imports upstream React TSX that Deno should not typecheck as Preact.

import React from "react";
import { createRoot } from "react-dom/client";
import { PlannotatorPlanBody } from "./PlannotatorPlanBody.tsx";
import "./plannotator.css";

const roots = new WeakMap();
const hosts = new WeakMap();

function tokenQuery() {
    const current = new URL(globalThis.location.href);
    const token = current.searchParams.get("token");
    return token ? `?token=${encodeURIComponent(token)}` : "";
}

function readEmbeddedPlanBody(host: HTMLElement) {
    const script = host.querySelector("script[data-plannotator-plan-body-json]");
    if (!script?.textContent) return null;
    try {
        const payload = JSON.parse(script.textContent);
        return typeof payload.body === "string" ? payload.body : null;
    } catch (error) {
        console.error(error);
        return null;
    }
}

async function loadPlanBody(planId: string, host: HTMLElement) {
    const embeddedBody = readEmbeddedPlanBody(host);
    if (embeddedBody !== null) return embeddedBody;

    const response = await fetch(`/api/plans/${encodeURIComponent(planId)}${tokenQuery()}`, {
        headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Unable to load Plan detail: ${response.status}`);
    const payload = await response.json();
    return payload.plan?.body ?? "";
}

function unmountPlannotatorPlanBody(host: HTMLElement) {
    const rootHost = host.querySelector("[data-plannotator-plan-body-root]") ?? host;
    const root = roots.get(rootHost);
    if (!root) return;
    root.unmount();
    roots.delete(rootHost);
    hosts.delete(host);
    if (host.dataset.plannotatorRenderer !== "fallback") {
        host.dataset.plannotatorRenderer = "ssr-fallback";
    }
}

async function mountPlannotatorPlanBody(host: HTMLElement) {
    const planId = host.dataset.planId;
    if (!planId) return;
    host.dataset.plannotatorRenderer = "loading";
    try {
        const markdown = await loadPlanBody(planId, host);
        const rootHost = host.querySelector("[data-plannotator-plan-body-root]") ?? host;
        const root = roots.get(rootHost) ?? createRoot(rootHost);
        roots.set(rootHost, root);
        hosts.set(host, rootHost);
        host.addEventListener("runwield:plannotator-plan-body:unmount", () => unmountPlannotatorPlanBody(host), {
            once: true,
        });
        root.render(React.createElement(PlannotatorPlanBody, { markdown }));
        host.dataset.plannotatorRenderer = "rendered";
    } catch (error) {
        host.dataset.plannotatorRenderer = "fallback";
        console.error(error);
    }
}

function mountAllPlannotatorPlanBodies() {
    for (const host of document.querySelectorAll("[data-plannotator-plan-body]")) {
        if (host.dataset.plannotatorRenderer === "rendered" || host.dataset.plannotatorRenderer === "loading") continue;
        void mountPlannotatorPlanBody(host);
    }
}

function findPlannotatorPlanBodyHosts(node: Node) {
    if (!(node instanceof HTMLElement)) return [];
    const hosts = Array.from(node.querySelectorAll("[data-plannotator-plan-body]"));
    if (node.matches("[data-plannotator-plan-body]")) hosts.unshift(node);
    return hosts;
}

const observer = new MutationObserver((records) => {
    for (const record of records) {
        for (const node of record.removedNodes) {
            for (const host of findPlannotatorPlanBodyHosts(node)) {
                unmountPlannotatorPlanBody(host);
            }
        }
        for (const node of record.addedNodes) {
            for (const host of findPlannotatorPlanBodyHosts(node)) {
                if (
                    host.dataset.plannotatorRenderer === "rendered" ||
                    host.dataset.plannotatorRenderer === "loading"
                ) continue;
                void mountPlannotatorPlanBody(host);
            }
        }
    }
});

function start() {
    mountAllPlannotatorPlanBodies();
    observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
    start();
}
