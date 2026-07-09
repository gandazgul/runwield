---
name: codebase-design
description: Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.
---

# Codebase Design

Design **deep modules**: a lot of behavior behind a small interface, placed at a clean seam, testable through that
interface. Use this language and these principles wherever code is being designed or restructured. The aim is leverage
for callers, locality for maintainers, and testability for everyone.

## Glossary

Use these terms exactly. Consistent language is the point.

**Module** — anything with an interface and an implementation. Deliberately scale-agnostic: a function, class, package,
or tier-spanning slice. _Avoid_: unit, component, service.

**Interface** — everything a caller must know to use the module correctly: the type signature, invariants, ordering
constraints, error modes, required configuration, and performance characteristics. _Avoid_: API, signature.

**Implementation** — what's inside a module: its body of code. Distinct from **Adapter**: a thing can be a small adapter
with a large implementation, or a large adapter with a small implementation. Reach for "adapter" when the seam is the
topic; "implementation" otherwise.

**Depth** — leverage at the interface: the amount of behavior a caller or test can exercise per unit of interface they
have to learn. A module is **deep** when a large amount of behavior sits behind a small interface, and **shallow** when
the interface is nearly as complex as the implementation.

**Seam** — a place where you can alter behavior without editing in that place; the location at which a module's
interface lives. Where to put the seam is its own design decision, distinct from what goes behind it. _Avoid_: boundary.

**Adapter** — a concrete thing that satisfies an interface at a seam. Describes role, not substance.

**Leverage** — what callers get from depth: more capability per unit of interface they learn. One implementation pays
back across many call sites and tests.

**Locality** — what maintainers get from depth: change, bugs, knowledge, and verification concentrate in one place
rather than spreading across callers. Fix once, fixed everywhere.

## Deep vs Shallow

**Deep module** = small interface + lots of implementation.

```text
+---------------------+
|   Small Interface   |
+---------------------+
|                     |
|  Deep Implementation|
|                     |
+---------------------+
```

**Shallow module** = large interface + little implementation.

```text
+------------------------------+
|       Large Interface        |
+------------------------------+
|  Thin Implementation         |
+------------------------------+
```

When designing an interface, ask:

- Can I reduce the number of methods?
- Can I simplify the parameters?
- Can I hide more complexity inside?

## Principles

- **Depth is a property of the interface, not the implementation.** A deep module can be internally composed of small,
  mockable, swappable parts; they just are not part of the interface.
- **The deletion test.** Imagine deleting the module. If complexity vanishes, it was a pass-through. If complexity
  reappears across callers, it was earning its keep.
- **The interface is the test surface.** Callers and tests cross the same seam. If you want to test past the interface,
  the module is probably the wrong shape.
- **One adapter means a hypothetical seam. Two adapters means a real seam.** Do not introduce a seam unless something
  actually varies across it.

## Designing For Testability

Good interfaces make testing natural:

1. **Accept dependencies, don't create them.**

   ```js
   // Testable
   function processOrder(order, paymentGateway) {}

   // Hard to test
   function processOrder(order) {
       const gateway = new StripeGateway();
   }
   ```

2. **Return results, don't produce side effects.**

   ```js
   // Testable
   function calculateDiscount(cart) {
       return new Discount(cart);
   }

   // Hard to test
   function applyDiscount(cart) {
       cart.total -= calculateDiscount(cart).amount;
   }
   ```

3. **Keep the surface area small.** Fewer methods mean fewer tests. Fewer parameters mean simpler setup.

## Relationships

- A **Module** has exactly one **Interface**.
- **Depth** is a property of a **Module**, measured against its **Interface**.
- A **Seam** is where a **Module**'s **Interface** lives.
- An **Adapter** sits at a **Seam** and satisfies the **Interface**.
- **Depth** produces **Leverage** for callers and **Locality** for maintainers.

## Rejected Framings

- **Depth as ratio of implementation-lines to interface-lines.** That rewards padding the implementation. Use
  depth-as-leverage instead.
- **"Interface" as only the TypeScript `interface` keyword or public methods.** Interface here includes every fact a
  caller must know.
- **"Boundary".** It is overloaded with DDD bounded contexts. Say **seam** or **interface**.

## Going Deeper

- **Deepening a cluster given its dependencies** — see [DEEPENING.md](DEEPENING.md).
- **Exploring alternative interfaces** — see [DESIGN-IT-TWICE.md](DESIGN-IT-TWICE.md).
