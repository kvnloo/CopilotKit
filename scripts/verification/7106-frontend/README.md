# #7106 frontend execution boundary (fork-only diagnostic)

Pinned subject: CopilotKit `eef659193309a8a4fc508289e87c2b80eff46a83`.
Author's Python candidate at inspection: `d4397524453abcd6463cc50448e1ff8c33c3fdd5`.

Question: with the normal `useFrontendTool` and `useHumanInTheLoop` hooks, does an interrupt-terminated run continue through ID-addressed `resume`, rather than merely appending tool messages and starting an ordinary follow-up?

This is separate from existing run 36034595466 (real Python graph / core-state roundtrip). That run is preserved. This diagnostic covers actual React/jsdom, actual registration/executor/renderer/respond, and captures the next run's input. The upstream run stream is a deterministic fixture, not Python, HTTP, a live model or a production browser. No `useInterrupt` bridge is added: this explicitly characterizes what the existing normal executor does alone.

A baseline must run an ordinary frontend function once, expose a live human response button, preserve the two actual results and start exactly one follow-up. A standard-interrupt case then asks for matching resume entries. Passing the baseline does not establish that the standard-interrupt contract passes. The report keeps these two results separate. A third baseline runs the tools/chat subtree with Strict Mode. A mutation replaces the ordinary handler's work with a placeholder: the baseline's positive-work assertion must reject it.

The report accepts either a satisfied contract or the exact missing-resume assertion as a characterization outcome. It does not relabel import, setup, missing-control, or other failures as the desired counterexample. A green characterization job can therefore mean a documented compatibility gap, not a product fix; read `receipt.json` / the job summary.

No production changes or upstream PR. No performance or durable exactly-once claim. Dependencies are resolved from the pinned repository lock without an SDK override. #7106's author retains design/implementation ownership.

Local execution before posting: TypeScript transpilation reported no syntax diagnostics; workflow YAML parsed; seven report-classifier self-checks passed using synthetic report objects. Those are harness checks, NOT the real React tests. The actual tests require the workflow's built workspace dependencies.

AI-use note: an AI assistant helped inspect the existing executor and hook tests and prepare this diagnostic. Its results must be read from the exact-run logs before sharing an integration claim upstream.
