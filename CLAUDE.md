# Claude Code Rules for pricectl

## Mandatory: Test-Driven Development (TDD)

All development in this repository **must** follow the TDD cycle. This is a non-negotiable requirement.

### The TDD Cycle

Every feature, bug fix, or change must follow the Red-Green-Refactor loop:

1. **Red** — Write a failing test that describes the desired behavior. The test must fail for the right reason (the behavior does not exist yet, not a compilation error).
2. **Green** — Write the minimum production code required to make the test pass. Do not write code that is not driven by a test.
3. **Refactor** — Clean up both production code and test code without changing behavior. All tests must remain green after refactoring.

Never write production code before writing a failing test. Never skip the refactor step.

### Classical School of TDD

Tests in this repository are written in the **Classical (Detroit) school** style:

- **Test behavior, not implementation.** Tests assert on observable outcomes (return values, state changes, interactions with real collaborators), not on internal implementation details.
- **Use real objects as collaborators.** When testing a unit, use the real collaborator objects rather than substituting them with mocks or stubs, unless the collaborator is an external dependency (see below).
- **Only mock at the boundaries.** Replace real objects with test doubles (mocks, stubs, fakes) only when the collaborator is:
  - An external system (e.g., the Stripe API, a database, the filesystem, network calls)
  - A time-dependent or non-deterministic dependency
  - So slow that it makes the test suite impractical
- **One logical assertion per test concept.** Each test should verify one specific behavior. Multiple `expect` calls are acceptable when they all relate to the same concept.
- **Descriptive test names.** Test names must clearly state what behavior is being verified and under what conditions.

### Test Pyramid

Structure the test suite according to the Test Pyramid. Maintain the correct ratio of test types:

```
        /\
       /  \
      / E2E\        ← Few: cover critical user journeys end-to-end
     /------\
    /        \
   /Integrat. \     ← Some: verify components work together correctly
  /------------\
 /              \
/   Unit Tests   \  ← Many: fast, focused tests for individual units
/----------------\
```

#### Unit Tests (majority of tests)

- Location: `src/__tests__/*.test.ts` within each package
- Scope: A single class, function, or module in isolation from external systems
- Speed: Must run in milliseconds; no I/O, no network, no timers
- Dependencies: Use real internal collaborators; only mock external boundaries
- Coverage target: All public methods and non-trivial logic paths

```typescript
// Good: tests the Product construct's behavior with real collaborators
describe('Product', () => {
  it('synthesizes name and active status into Stripe properties', () => {
    const stack = new Stack(undefined, 'TestStack', { apiKey: 'sk_test_dummy' });
    new Product(stack, 'Prod', { name: 'Widget' });

    const manifest = stack.synth();

    expect(manifest.resources[0].properties).toMatchObject({ name: 'Widget', active: true });
  });
});
```

#### Integration Tests (moderate number)

- Location: `src/__tests__/integration/*.test.ts` within each package, or a top-level `test/integration/` directory
- Scope: Multiple real components working together; may include file system or in-process databases
- Speed: Can be slower than unit tests but must not call live external APIs
- Dependencies: Use fakes or recorded responses for external APIs (e.g., a Stripe mock server or recorded fixtures); never hit the live Stripe API

#### End-to-End Tests (few)

- Location: `test/e2e/`
- Scope: Full deployment cycle against a real Stripe test-mode environment
- Speed: Slowest; run in CI only, not on every commit
- Dependencies: Require a real `STRIPE_SECRET_KEY` in test mode; must clean up all created resources

### Adding New Code

When adding a new Stripe resource, construct, CLI command, or any other feature, follow this order strictly:

1. Write a unit test describing the new behavior — watch it fail.
2. Implement the minimum code to make it pass.
3. Refactor.
4. If the feature involves cross-package interaction, add an integration test — watch it fail, make it pass, refactor.
5. If the feature changes the observable end-to-end behavior of the CLI, add or update an E2E test.

### Refactoring

- Refactoring is only safe when all tests are green.
- Never refactor and add behavior in the same commit.
- Test code is production code: refactor it with the same care.

## Code Style

- Use TypeScript for all new code.
- Follow existing code conventions and the ESLint/Prettier configuration.
- Keep functions small and focused.
- Add JSDoc comments for public APIs.

## Running Tests

```bash
# Run all tests
pnpm test

# Run tests for a specific package
cd packages/core && pnpm test

# Run tests in watch mode (recommended during TDD)
pnpm test --watch

# Run tests with coverage
pnpm test --coverage
```

Tests must pass before any commit is made. A failing test suite is a blocker — do not commit or push broken tests.
