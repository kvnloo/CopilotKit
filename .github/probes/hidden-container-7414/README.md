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

## Validation status when authored

JavaScript syntax and Python compilation were checked in the assistant container.
The container has no browser dependencies and cannot resolve GitHub; no local
browser execution is claimed. Native browser results must come from the linked
Actions run and its `hidden-container-7414-evidence` artifact.
