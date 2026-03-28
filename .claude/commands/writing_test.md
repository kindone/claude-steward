# Agent Playbook for Writing Property Tests

## Before You Begin

**Is the implementation written?**

- **No** → Spec-first mode. Your first output is a stub file with `it.todo()` blocks.
  The stub is committed before any implementation. It is the implementation target.
- **Yes** → Verification mode. Write the full property with generators and assertions.
- **Trivial** → Write the test alongside. Never after.

**Fill in this header before writing anything else:**

```ts
// Feature:        [user-visible capability this protects]
// Arch/Design:    [structural constraint this derives from, if any]
// Spec:           [precise, verifiable statement — not prose]
// @quality:       [security | reliability | correctness | performance]
// @type:          [property | contract | stateful | chaos | example]
// @mode:          [spec-first | verification | alongside]
```

**Cannot fill in `Spec:` precisely → stop.** Come back when the requirement
is clear enough to state as a verifiable contract. A well-formed spec implies
the function signature, preconditions, postconditions, and invariants.
In spec-first mode the spec IS the implementation contract — the implementer
reads it, not a prose description.

---

## Core Concept: Every Property Is a Quantifier Statement

Before writing a test, state the property in quantifier form:

- `∀ x ∈ D: P(x)` — correctness/invariants; sample D broadly
- `¬∃ x ∈ D: bad(x)` — safety/no-crash; hunt for counterexamples, bias generators toward bad cases
- `∃ x ∈ D: P(x)` — reachability/liveness; search for a witness (bounded run, not just generate-and-check)

**D must be explicit.** Vague domain = vague test. Writing out D often surfaces missing dimensions: concurrency, failure injection, long sequences, adversarial inputs. Nested quantifiers map directly to test structure: outer ∀ → generators, inner ∃ → assertion within a single run.

---

## Derive from Strongest Source First

Trace every property to a source; if you can't, question it:

1. Spec / API contract
2. Invariants and design constraints
3. Reference/model behavior
4. Domain laws (idempotence, commutativity, monotonicity, algebraic identities)
5. Implementation details _(lowest priority; label these explicitly as internal regression tests)_

Also mine: inline `// INVARIANT:` / `// NOTE:` comments, pre/postconditions, `requires` clauses, standards and RFCs.

---

## Prefer General Over Specific

Ask of every check: _"Would this still make sense if the component were reimplemented with a different data structure?"_

- **Yes** → good general property: stable across refactors, reusable across implementations
- **No** → implementation-specific: keep only when deliberately locking in internals

Prefer: externally observable behavior, documented guarantees, model equivalence.

When a more general property B subsumes A, retire A — but **gradually**: run both, confirm no loss in bug-finding, then remove A. Exception: keep dedicated crash/stress properties even when logically implied by stronger ones — they add unique value at high load and in adversarial subdomains.

---

## Spec-First Stub Template

In spec-first mode, produce this before implementation. The stub is runnable
immediately — it fails with "not a function" until the implementation exists.

```ts
// [feature]/[spec-name].prop.ts
//
// Spec:     [precise statement — this IS the implementation contract]
// @quality: [...]
// @type:    property
// @mode:    spec-first
//
// Derived signature: function [name]([params from D]): [return type from P]

describe('[spec name]', () => {

  describe('∀ [domain D]: [invariant P]', () => {
    it.todo('[typical subdomain]')
    it.todo('[boundary subdomain]')
    it.todo('[adversarial subdomain]')
  })

  describe('¬∃ input: [function name] throws', () => {
    it.todo('[stress subdomain]')
  })

})
```

The function signature is derivable from the spec: D defines the parameters,
P defines the return type. Commit this file. Implement the function.
Then promote `it.todo()` to full `forAll()` assertions.

**For contract stubs** — list the four sections with `it.todo()` entries.
Both producer and consumer are implemented to satisfy the contract;
neither is implemented first.

**For stateful stubs** — include a reference model skeleton:

```ts
// Reference model skeleton — simpler, obviously correct
class [Name]Reference {
  apply(action: Action): void { /* obvious correct impl */ }
  matches(sut: SystemUnderTest): boolean { /* state comparison */ }
}
```

---

## Subdomains: Find Good Ones, Then Vary Across Them

Testing quality depends heavily on which subdomains you explore. Identify a minimal but meaningful set:

- _Typical/steady-state_: normal inputs, common operation sequences
- _Boundary/extreme_: empty, null, max/min values, single-element, maximum size
- _Error/invalid paths_: malformed input, out-of-range, invalid state transitions
- _Stress/long-sequence_: high load, long action sequences, adversarial patterns

For each property, decide which subdomains matter and why. Don't just enumerate them — understand which are likely to expose bugs.

**Vary across subdomains, not just within them.** Different runs should explore different distributions. Weighted generators are one way to do this within a single run. Going further: randomize the weights themselves (hyperparameters) so each run explores a different subdomain emphasis. The goal is that across many runs, no meaningful subdomain is consistently neglected.

**Nested property tests are encouraged.** An outer property test can generate hyperparameters (e.g., subdomain weights, sequence lengths, failure probabilities), and an inner property test runs the actual property under those parameters. This makes subdomain exploration itself a subject of randomized testing.

---

## Stateful Testing: Action Sequences + Reference Model

Stateful components are the real challenge and testing them are most impactful.

Pattern: `initial_state → action_sequence → checks`

- Maintain a **simple reference model** alongside the implementation
- Check **per-action**: invariants hold after each step
- Check **end-of-sequence**: state matches reference model
- Actions must be semantically meaningful at API level, not internal steps
- Bias action generation: boost error-path actions, state-boundary transitions, long sequences

Use an `onEachAction`-style hook when available to centralize per-step invariant checks.

The Property TDD loop for stateful systems:

    Model     → define states, actions, invariants; write reference model stub
    Stub      → create state machine interface with it.todo() blocks
    Implement → write transitions satisfying the reference model
    Explore   → generate random action sequences; check per-step invariants
    Refine    → fix transitions or tighten invariants as needed
    ↑_________ loop until no violations found

---

## Contract Tests: Bilateral Structure

For any test covering an interface between two components, use four sections:

```ts
describe('[producer] ↔ [consumer] contract', () => {
  describe('producer guarantees', () => { ... })
  describe('consumer assumptions', () => { ... })
  describe('temporal invariants', () => { ... })   // ordering, sequencing
  describe('bilateral invariants', () => { ... })  // ∀ sequences both sides agree on
})
```

**Temporal invariants** are distinct from message validity — they cover ordering
constraints: "A always precedes B", "exactly one terminal event per session".

When a contract test fails, the section identifies which side broke:
- _Producer guarantee_ fails → dependency broke its promise
- _Consumer assumption_ fails → you assumed something never guaranteed
- _Temporal invariant_ fails → sequencing constraint violated
- _Bilateral invariant_ fails → interface needs renegotiation

---

## Chaos Tests: Failure Injection

For failure injection tests, always name the failure type explicitly with `@failure-type`:

    process-kill | socket-drop | slow-response | partial-write | network-partition

```ts
describe('@failure-type: socket-drop', () => {
  it('system detects failure within [bound]', ...)
  it('[invariant] holds after recovery', ...)
  it('no data is silently lost', ...)
  it('system reaches valid state regardless of failure timing', ...)
})
```

Cover failure at startup, mid-operation, and mid-shutdown separately —
they are different scenarios with different recovery paths.

---

## Example Tests: Use Sparingly

Ask first: _"Would a property test (∀) or stateful test cover this and more?"_
If yes, prefer the property.

Valid reasons to use a specific scenario test:
- The exact inputs matter (protocol handshake, known regression)
- Integration glue easier to read as a concrete example
- UI rendering where specific visual output matters more than exploration

---

## Check Timing Follows Property Shape

| Property shape | When to check |
|---|---|
| `∀ seq: no bad intermediate state` | After each action |
| `∀ seq: final state satisfies P` | End of sequence |
| `∃ path: progress/recovery` | Bounded run + witness condition |

---

## Fundamental Properties

Apply these systematically to any stateful component:

| Property | What to verify |
|---|---|
| Crash tolerance | No crash or abort on any action sequence |
| Malfunction tolerance | Graceful handling of injected dependency failures (allocator, I/O, network) |
| Exception safety | Basic/strong/nothrow: exceptions don't corrupt state |
| Memory safety | No leaks, double-free, use-after-free — use sanitizers (ASAN, MSAN) |
| Thread safety | No data races, no deadlocks under concurrent access |
| Resource management | Every acquired resource is released (RAII compliance) |
| Observability | Query methods return values consistent with model state |
| Consistency | Component-specific invariants hold across all operations |
| Reference comparison | New implementation matches reference for all inputs |
| Algorithm correctness | Output correct, complexity within stated bounds |

---

## Advanced Properties (Domain-Specific)

Pull in when the component's domain warrants it:

- **ACID** (databases): atomicity, consistency, isolation, durability
- **Concurrency**: serializability, liveness (no deadlock/starvation/livelock), wait-freedom
- **Distributed systems**: eventual consistency, causal consistency, linearizability
- **CAP tradeoffs**: verify the system's chosen consistency/availability/partition-tolerance tradeoff holds
- **Networking/protocols**: delivery reliability (at-least/at-most/exactly-once), ordering guarantees, timeout/retry
- **Security**: authentication, authorization, confidentiality, integrity

---

## Quality Bar Before Adding a Property

1. Can you trace it to a source (spec, invariant, domain law)?
2. Is D explicit and are subdomains identified?
3. Is check timing correct — per-step or end-state?
4. Is it loosely coupled to implementation details? (unless intentional)
5. Does it add coverage not provided by a stronger existing property?
6. Will failures produce actionable output — good shrinking, clear witnesses?
7. For contracts: are all four sections present including temporal invariants?
8. For spec-first: is the stub committed before the implementation?
