---
name: write-tests
description: Use this skill to write, update, or repair automated tests for existing code. Use when the task involves adding test coverage, fixing flaky tests, or creating regression tests for bugs. Language/framework-agnostic. For test-driven development, use the tdd skill. For general QA and behavioral verification, use the tester agent.
---

# Write Tests

Use this skill to write or update automated tests for existing code. It is language- and framework-agnostic; adapt its
principles to the project's installed test stack.

## Philosophy

**Tests verify behavior through public interfaces, not implementation details.** A good test tells you _what_ the system
does, not _how_ it does it. Bad tests are coupled to internal structure and break on refactors that don't change
behavior.

### Signs of a good test

- Tests behavior users or callers care about (the "what")
- Uses the module's public API only
- Survives internal refactors (rename a private helper? test shouldn't care)
- One logical assertion per test
- Deterministic: same input always produces the same pass/fail
- Fast enough to run frequently

### Signs of a bad test

- Mocks internal collaborators of the module under test
- Tests private methods or internal state
- Asserts on call counts or call order of mocks
- Test name describes _how_ (e.g., "calls paymentService.process") not _what_ (e.g., "charges the user's card")
- Test breaks when you refactor without changing observable behavior
- Verifies through external means instead of the module's own interface (e.g., querying a database directly after
  calling a function instead of calling a retrieval function)

## Before You Write

1. **Discover the project's conventions**
   - Read existing tests to identify framework, assertion style, file naming, and fixture patterns.
   - Check project configuration files (package manager, build scripts, test runner config).
   - If the project has a memory store, recall testing preferences.
   - If framework-specific skills exist in the project or user's global skills (e.g., `playwright`, `pytest`, `vitest`),
     load them for detailed guidance.

2. **Understand what to test**
   - Read the implementation code. Identify the public API or module contract.
   - Prioritize: happy path first, then edge cases, then error handling.
   - Do not invent tests for behaviors that were not requested unless they protect against evidenced regression risk.
   - One test = one focused behavior. Do not combine multiple scenarios into a single assertion block.

3. **Know what not to test**
   - Implementation details (private functions, internal state transitions not exposed through the interface)
   - Trivial delegation (a function that simply passes through to another function)
   - Third-party library behavior (assume the library works, test that your code uses it correctly)

## How to Write Tests

### Prefer real collaborators and fakes over mocks

Use the real object where practical. For expensive or unreliable collaborators (external APIs, databases, file system,
time/randomness), prefer:

1. **Fakes** — lightweight in-memory implementations of the same interface (e.g., an in-memory database instead of
   mocking the database client)
2. **Mocks only at system boundaries** — external APIs you don't control, paid services, hardware interfaces

```typescript
// GOOD: Uses a real collaborator (or a fake)
test("order total includes tax", () => {
    const taxCalculator = new TaxCalculator(0.08); // real object
    const order = new Order(taxCalculator);
    order.addItem({ price: 100 });
    expect(order.total).toBe(108);
});

// AVOID: Mocking an internal collaborator you control
test("order total includes tax", () => {
    const mockTax = { apply: jest.fn().mockReturnValue(108) };
    const order = new Order(mockTax);
    order.addItem({ price: 100 });
    expect(mockTax.apply).toHaveBeenCalledWith(100);
});
```

### Test through the public interface

Do not bypass your own code to verify state. Verify through the same interface a caller would use.

```typescript
// BAD: Bypasses the interface to inspect database state
test("createUser saves to database", async () => {
    await createUser({ name: "Alice" });
    const row = await db.query("SELECT * FROM users WHERE name = ?", ["Alice"]);
    expect(row).toBeDefined();
});

// GOOD: Verifies through the public API
test("createUser makes user retrievable", async () => {
    const user = await createUser({ name: "Alice" });
    const retrieved = await getUser(user.id);
    expect(retrieved.name).toBe("Alice");
});
```

### Make tests deterministic

- Do not depend on shared mutable state between tests.
- Each test should create its own fixtures from scratch.
- For code that uses clocks or random numbers, inject those values explicitly.

### Name tests by behavior, not implementation

```typescript
// GOOD: Describes the behavior
test("rejects expired credit cards");

// BAD: Describes the implementation
test("calls validateExpiry on the payment service");
```

### Regression tests for bugs

When a real bug is found, write the smallest test that reproduces the failure before fixing it. A regression test
should:

1. Prove the bug exists (test fails before fix)
2. Prove the bug is fixed (test passes after fix)
3. Stay in the suite as a permanent guard

## After Writing

1. **Run the new tests** — verify they pass (or fail as expected for a bug reproduction).
2. **Run the full test suite** — confirm you didn't break anything.
3. **Iterate** — if a test fails because your test code is flawed, fix the test. If the test reveals an implementation
   bug, fix the implementation. If the fix is outside your assigned scope, document the failure clearly.

## Stack-Agnostic Adaptability

This skill does not dictate a language, framework, or test runner. Adapt its principles:

- **JavaScript/TypeScript**: `vitest`, `jest`, `mocha`, `node:test`, `deno test`
- **Python**: `pytest`, `unittest`
- **Go**: `testing` package, `testify`
- **Rust**: `cargo test`, `rstest`

If the project has framework-specific skills loaded, read them after this skill for detailed syntax and conventions.
