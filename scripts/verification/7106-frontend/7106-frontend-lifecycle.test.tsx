/**
 * Fork-only #7106 boundary probe; installed beside the existing hook tests.
 * Uses real hooks/core/executor/render/respond and a scripted AG-UI stream.
 * Does NOT use the Python candidate, a bridge, real HTTP or a browser.
 */
import React, { useEffect } from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { from, type Observable } from "rxjs";
import { z } from "zod";
import { useFrontendTool } from "../use-frontend-tool";
import { useHumanInTheLoop } from "../use-human-in-the-loop";
import { CopilotChat } from "../../components/chat/CopilotChat";
import { renderWithCopilotKit } from "../../__tests__/utils/test-helpers";

interface Trace {
  inputs: RunAgentInput[];
  ordinaryCalls: unknown[];
  clicked: unknown[];
  statuses: string[];
}

class LifecycleAgent extends AbstractAgent {
  constructor(readonly trace: Trace, readonly interrupted: boolean) {
    super({ agentId: "default" });
  }

  clone(): this {
    const next = new LifecycleAgent(this.trace, this.interrupted);
    next.agentId = this.agentId;
    next.threadId = this.threadId;
    return next as this;
  }

  // Real AbstractAgent.runAgent still handles transform/apply/verify/subscribers.
  // Only the transport/model's emitted events are fixture data.
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.trace.inputs.push(JSON.parse(JSON.stringify(input)));
    const start = {
      type: EventType.RUN_STARTED,
      threadId: input.threadId,
      runId: input.runId,
    };
    const terminal = {
      type: EventType.RUN_FINISHED,
      threadId: input.threadId,
      runId: input.runId,
    };
    if (this.trace.inputs.length > 1) {
      return from([start, terminal]);
    }
    const calls = [
      { id: "fe-ordinary", name: "readSelection", args: { selection: "blue" } },
      { id: "fe-human", name: "chooseNext", args: { question: "Continue?" } },
    ];
    const events: BaseEvent[] = [start];
    for (const call of calls) {
      events.push(
        {
          type: EventType.TOOL_CALL_START,
          toolCallId: call.id,
          toolCallName: call.name,
          parentMessageId: "assistant-1",
        } as BaseEvent,
        {
          type: EventType.TOOL_CALL_ARGS,
          toolCallId: call.id,
          delta: JSON.stringify(call.args),
        } as BaseEvent,
        { type: EventType.TOOL_CALL_END, toolCallId: call.id } as BaseEvent,
      );
    }
    events.push(this.interrupted ? {
      ...terminal,
      outcome: {
        type: "interrupt",
        interrupts: [
          { id: "gate-ordinary", reason: "tool_call", toolCallId: "fe-ordinary", value: {} },
          { id: "gate-human", reason: "tool_call", toolCallId: "fe-human", value: {} },
        ],
      },
    } as BaseEvent : terminal);
    return from(events);
  }
}

async function exercise(interrupted: boolean, strict = false) {
  const trace: Trace = { inputs: [], ordinaryCalls: [], clicked: [], statuses: [] };
  const agent = new LifecycleAgent(trace, interrupted);

  function Tools() {
    useFrontendTool({
      name: "readSelection",
      parameters: z.object({ selection: z.string() }),
      handler: async (args) => {
        // Negative control is intentionally a fixture mutation, not a fix.
        if (process.env.PROBE_MUTATION === "skip-ordinary-work") return { ok: true };
        trace.ordinaryCalls.push(args);
        return { selected: args.selection, source: "real-frontend-handler" };
      },
    }, []);
    useHumanInTheLoop({
      name: "chooseNext",
      parameters: z.object({ question: z.string() }),
      render: ({ status, respond, result }) => {
        useEffect(() => { trace.statuses.push(status); }, [status]);
        return <div>
          <span data-testid="phase">{status}</span>
          {respond && <button type="button" onClick={() => {
            const answer = { approved: false, source: "human-button" };
            trace.clicked.push(answer);
            void respond(answer);
          }}>Use this answer</button>}
          {result && <output data-testid="human-result">{result}</output>}
        </div>;
      },
    }, []);
    return null;
  }
  const children = <><Tools /><div style={{ height: 400 }}>
    <CopilotChat welcomeScreen={false} />
  </div></>;
  renderWithCopilotKit({
    agent, defaultThrottleMs: 0,
    children: strict ? <React.StrictMode>{children}</React.StrictMode> : children,
  });
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "Inspect blue and ask me" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

  // Reachable human control is proof that the normal execution lifecycle ran.
  const button = await screen.findByRole("button", { name: "Use this answer" });
  expect(trace.inputs.length, "NO_FOLLOWUP_BEFORE_HUMAN_ANSWER").toBe(1);
  expect(trace.ordinaryCalls, "ORDINARY_WORK_MUST_EXECUTE_ONCE").toEqual([{ selection: "blue" }]);
  expect(screen.queryByTestId("human-result"), "NO_PLACEHOLDER_HUMAN_SUCCESS").toBeNull();
  fireEvent.click(button);
  await waitFor(() => expect(trace.inputs.length).toBe(2));
  await waitFor(() => expect(screen.getByTestId("human-result").textContent).toContain("human-button"));

  const nextInput = trace.inputs[1];
  const results = nextInput.messages.filter((m) => m.role === "tool");
  expect(results.length, "ONE_RESULT_PER_ORIGINAL_CALL").toBe(2);
  const contents = new Map(results.map((m) => [m.toolCallId, JSON.parse(m.content)]));
  expect(contents.get("fe-ordinary"), "ORDINARY_RESULT_IDENTITY").toEqual({ selected: "blue", source: "real-frontend-handler" });
  expect(contents.get("fe-human"), "HUMAN_RESULT_IDENTITY").toEqual({ approved: false, source: "human-button" });
  expect(trace.ordinaryCalls, "ORDINARY_WORK_MUST_EXECUTE_ONCE").toHaveLength(1);
  expect(trace.clicked, "HUMAN_CALLBACK_MUST_EXECUTE_ONCE").toHaveLength(1);
  expect(new Set(trace.statuses).size, "REAL_RENDERER_LIFECYCLE_REQUIRED").toBeGreaterThanOrEqual(2);
  return nextInput;
}

describe("7106 frontend lifecycle boundary", () => {
  it("baseline normal executor preserves ordinary work and the human result", async () => {
    const next = await exercise(false);
    expect(next.resume).toBeUndefined();
  });

  it("baseline Strict Mode preserves ordinary work and the human result", async () => {
    await exercise(false, true);
  });

  it("standard interrupt follow-up addresses the original gates", async () => {
    const next = await exercise(true);
    // This is the desired integration contract, NOT an assumed green result.
    expect(next.resume, "STANDARD_FOLLOWUP_MUST_ADDRESS_INTERRUPTS").toEqual(
      expect.arrayContaining([
        { interruptId: "gate-ordinary", status: "resolved", payload: { selected: "blue", source: "real-frontend-handler" } },
        { interruptId: "gate-human", status: "resolved", payload: { approved: false, source: "human-button" } },
      ]),
    );
    expect(next.resume).toHaveLength(2);
  });
});
