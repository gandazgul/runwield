# When to Mock

Mock at **system boundaries** only:

- External APIs and services you do not control (payment, email, hosted CI, model calls)
- Subprocesses or hardware that cannot be exercised cheaply and deterministically in a fixture
- Time and randomness

Don't mock:

- Your own classes/modules
- Internal collaborators
- Anything you control
- Databases, file systems, repositories, and persistence machinery when a temporary real fixture is practical

## Designing for Mockability

At genuine external boundaries, define a required, declared capability port. Dependency injection is not a general
testability technique: it is an ownership statement, and product-owned machinery must remain composed and real.

**1. Inject only the declared external capability**

Pass the external client in explicitly at the composition root. Do not add an optional fallback, override bag, or
test-only branch, and do not inject an internal wrapper around the client.

```typescript
// GOOD: a required port for a genuine external payment provider
function processPayment(order, paymentClient) {
    return paymentClient.charge(order.total);
}

// BAD: an optional fallback makes the implementation replaceable by convention
function processPayment(order, paymentClient = new StripeClient(process.env.STRIPE_KEY)) {
    return paymentClient.charge(order.total);
}
```

**2. Prefer SDK-style interfaces over generic fetchers**

Create specific functions for each external operation instead of one generic function with conditional logic:

```typescript
// GOOD: Each function is independently mockable
const api = {
    getUser: (id) => fetch(`/users/${id}`),
    getOrders: (userId) => fetch(`/users/${userId}/orders`),
    createOrder: (data) => fetch("/orders", { method: "POST", body: data }),
};

// BAD: Mocking requires conditional logic inside the mock
const api = {
    fetch: (endpoint, options) => fetch(endpoint, options),
};
```

The SDK approach means:

- Each mock returns one specific shape
- No conditional logic in test setup
- Easier to see which endpoints a test exercises
- Type safety per endpoint
