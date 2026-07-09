# Deepening

How to deepen a cluster of shallow modules safely, given its dependencies. Assumes the vocabulary in
[SKILL.md](SKILL.md): **module**, **interface**, **seam**, and **adapter**.

## Dependency Categories

When assessing a candidate for deepening, classify its dependencies. The category determines how the deepened module is
tested across its seam.

### 1. In-Process

Pure computation, in-memory state, no I/O. Always deepenable: merge the modules and test through the new interface
directly. No adapter needed.

### 2. Local-Substitutable

Dependencies that have local test stand-ins, such as PGLite for Postgres or an in-memory filesystem. Deepenable if the
stand-in exists. The deepened module is tested with the stand-in running in the test suite. The seam is internal; no
port at the module's external interface.

### 3. Remote But Owned

Your own services across a network seam: microservices, internal APIs, queues. Define a **port** at the seam. The deep
module owns the logic; transport is injected as an **adapter**. Tests use an in-memory adapter. Production uses an HTTP,
gRPC, or queue adapter.

Recommendation shape: _"Define a port at the seam, implement an HTTP adapter for production and an in-memory adapter for
testing, so the logic sits in one deep module even though it is deployed across a network."_

### 4. True External

Third-party services you do not control. The deepened module takes the external dependency as an injected port; tests
provide a mock adapter.

## Seam Discipline

- **One adapter means a hypothetical seam. Two adapters means a real one.** Do not introduce a port unless at least two
  adapters are justified, typically production plus test.
- **Internal seams vs external seams.** A deep module can have internal seams private to its implementation, used by its
  own tests, as well as the external seam at its interface. Do not expose internal seams through the interface just
  because tests use them.

## Testing Strategy

- Old unit tests on shallow modules become waste once tests at the deepened module's interface exist. Delete them.
- Write new tests at the deepened module's interface. The **interface is the test surface**.
- Tests assert on observable outcomes through the interface, not internal state.
- Tests should survive internal refactors. They describe behavior, not implementation.
