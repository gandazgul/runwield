# HTML Report Format

The architecture review is rendered as a single self-contained HTML file in the OS temp directory. Tailwind and Mermaid
come from CDNs. Mermaid handles graph-shaped diagrams; hand-built HTML/CSS/SVG handles editorial visuals such as mass
diagrams, cross-sections, and call-graph collapse diagrams.

## Location

Resolve the temp directory from `$TMPDIR`, then `/tmp`, then `%TEMP%` on Windows. Write to:

```text
<tmpdir>/architecture-review-<timestamp>.html
```

Do not write the report into the repository.

## Scaffold

```html
<!doctype html>
<html lang="en">
    <head>
        <meta charset="utf-8" />
        <title>Architecture review - {{repo name}}</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <script type="module">
        import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
        mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
        </script>
        <style>
        .seam {
            stroke-dasharray: 4 4;
        }
        .leak {
            stroke: #dc2626;
        }
        .deep {
            background: linear-gradient(135deg, #0f172a, #1e293b);
        }
        </style>
    </head>
    <body class="bg-stone-50 text-slate-900 font-sans">
        <main class="max-w-5xl mx-auto px-6 py-12 space-y-12">
            <header>...</header>
            <section id="candidates" class="space-y-10">...</section>
            <section id="top-recommendation">...</section>
        </main>
    </body>
</html>
```

## Header

Repo name, local date, and a compact legend:

- solid box = module
- dashed line = seam
- red arrow = leakage
- thick dark box = deep module

Go straight into candidates. Avoid an introduction paragraph.

## Candidate Card

Each candidate is one `<article>`:

- **Title** — short, names the deepening.
- **Badge row** — recommendation strength: `Strong`, `Worth exploring`, or `Speculative`; dependency category:
  `in-process`, `local-substitutable`, `ports & adapters`, or `mock`.
- **Files** — monospaced list.
- **Before / After diagram** — the centerpiece.
- **Problem** — one sentence.
- **Solution** — one sentence.
- **Wins** — short bullets, each no more than six words when possible.
- **ADR callout** — only when applicable.

No long paragraphs. If the diagram needs a paragraph to be understood, redraw the diagram.

## Diagram Patterns

Choose the pattern that fits the candidate. Mix patterns so the report does not become visually repetitive.

### Mermaid Graph

Use Mermaid `flowchart`, `graph`, or `sequenceDiagram` when the point is dependency shape, call flow, or round-trips.

```html
<div class="rounded-lg border border-slate-200 bg-white p-4">
    <pre class="mermaid">
    flowchart LR
      A[OrderHandler] --> B[OrderValidator]
      B --> C[OrderRepo]
      C -.leak.-> D[PricingClient]
      classDef leak stroke:#dc2626,stroke-width:2px;
      class C,D leak
  </pre>
</div>
```

### Hand-Built Boxes And Arrows

Use positioned `<div>` boxes and inline SVG arrows when Mermaid's layout fights the story.

### Cross-Section

Stack horizontal bands to show layered shallowness. Before: many thin layers. After: one deep band.

### Mass Diagram

Show interface size compared with implementation size. Before: interface nearly as tall as implementation. After:
interface short, implementation tall.

### Call-Graph Collapse

Before: tree of calls as nested boxes. After: one deep module with internal calls faded inside.

## Style

- Lean editorial, not corporate dashboard.
- Use generous whitespace.
- Use one accent color plus red for leakage and amber for warnings.
- Keep diagrams around 320px tall so before/after sits comfortably side by side.
- Use exact `codebase-design` vocabulary: module, interface, implementation, depth, deep, shallow, seam, adapter,
  leverage, locality.
- Do not substitute: component, service, unit, API, signature, boundary, layer, wrapper.

## Top Recommendation

One larger card with the candidate name, one sentence on why it should come first, and an anchor link to its card.
