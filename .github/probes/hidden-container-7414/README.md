# CopilotKit #7414: fork-only browser characterization

AI-assisted work. Upstream source is pinned to `0d7e702d31cfab61e9a7e738e02f1f5fce4c9abb`.
This branch adds a static Storybook fixture, a Chromium probe, an isolated source
ablation helper and a fork-only workflow. It does not change production source,
package versions, the lockfile, or upstream CI.

## Question

Can we independently reproduce both causes in
https://github.com/CopilotKit/CopilotKit/issues/7414 before choosing a production fix?

The fixture uses the real built `CopilotChatView` with 80 static rows, actual mouse
wheel input and a mounted container that is hidden, re-rendered and restored.
No LLM calls or real credentials are used. Runtime discovery is stubbed locally;
external browser requests are blocked.

## Falsifiable hypothesis matrix (not results)

| Build | Auto-scroll | Re-render without hiding | Hide/re-render/show |
| --- | --- | --- | --- |
| Baseline | `none` | Position preserved | Jumps to bottom |
| Baseline | `pin-to-bottom` | Position preserved | Jumps to bottom |
| Alignment-only ablation | `none` | Position preserved | Position preserved |
| Alignment-only ablation | `pin-to-bottom` | Position preserved | Still jumps to bottom |

The ablation guards the existing end-alignment effect against reactivation on the
same first-message ID. It leaves `use-stick-to-bottom` unchanged and is applied
only inside the disposable runner after the unmodified baseline. It is not a
proposed fix or an assertion that thread-ID semantics are sufficient long-term.

Every case requires real active virtualization, a middle-of-thread starting
position, a stable layout, the same scroll element and actual zero-height
observation for hide/show. It records the visible row ID and relative offset,
scroll dimensions, browser version, screenshots and traces. Setup failures or
page crashes are `probe_error`, not evidence of the reported bug. Unexpected
behavior is retained and fails the workflow rather than being explained away.

**Green means this causal hypothesis matched all eight observations; it does not
mean the product is fixed.** A later production candidate must preserve the
reading position in both hide/show modes and retain first activation, intentional
thread navigation and pinned streaming behavior. No upstream PR should be opened
from this diagnostic branch.

## Scroll-write diagnostics

After establishing the stable middle-of-thread position, the probe instruments
only that scroll element. Each receipt includes JavaScript write attempts and
stacks for `scrollTop`, `scrollTo`, `scrollBy`, and `scroll`, along with native
scroll events, observed height transitions, and hide/show/re-render phase marks.
The trace is capped at 256 records with an explicit `dropped` count. Instrumented
properties are restored and the extra observer is disconnected before screenshots
and trace finalization, including on failure.

The observer never scrolls or suppresses existing callbacks. Write instrumentation
forwards native receivers and arguments without re-reading option getters or
coercing values again. A logged attempt is not proof of movement: correlate it with
the observed scroll events and before/after row anchors. Browser-internal scrolling
need not have a JavaScript writer stack. This is not a claim to trace every source
of scrolling.

Diagnostics add overhead. Repeat with `TRACE_SCROLL=0` to compare the same matrix
without instrumentation before relying on a timing-sensitive finding. Trace
timestamps are diagnostic ordering evidence, not a latency benchmark.

## Validation status

JavaScript syntax was checked with `node --check`. The `startScrollTrace` function
was also extracted from this exact probe and exercised on a synthetic scrollable
DOM in local Chromium `144.0.7559.96`: 11 diagnostic self-checks passed. They covered
native offsets and returns, single evaluation of option getters, native errors,
write stacks, zero/restored heights, unrelated-element exclusion, descriptor
restoration, idempotent cleanup, bounded records, and pre-existing own methods.

**Those checks validate the instrumentation, not the CopilotKit application or the
eight-row hypothesis matrix.** The local container could not resolve GitHub or
install the missing React/workspace dependencies. No local execution of the real
`CopilotChatView` fixture is claimed. Application evidence must come from an actual
completed run and its `hidden-container-7414-evidence` artifact.

## Running and reviewing the evidence

The fork workflow is `.github/workflows/hidden-container-7414.yml`. A push to
`test/7414-hidden-container-browser-20260924` starts the diagnostic run, provided
Actions is enabled on the fork. Its token is read-only, and the source ablation
is never pushed back to the repository.

The workflow installs frozen workspace dependencies, builds the real React
package and the single fixture, serves it on loopback, and invokes:

```sh
node .github/probes/hidden-container-7414/probe.mjs baseline
# After the source-pinned ablation and rebuilding the package + fixture:
node .github/probes/hidden-container-7414/probe.mjs alignment-only
```

Review both `receipts.json` files before drawing a conclusion: each must contain
four observations, with both ordinary re-render controls preserving position.
A missing report, build failure, or `probe_error` means the hypothesis was not
tested successfully. `unexpected_behavior` is a reason to revise the hypothesis,
not to weaken the controls. Queue or runner status is not a browser result.
