import React, { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  CopilotChatConfigurationProvider,
  CopilotChatView,
  CopilotKitProvider,
} from "@copilotkit/react-core/v2";

// Fork-only, AI-assisted fixture. Real chat layout; static messages; no agent calls.
const messages = Array.from({ length: 80 }, (_, index) => ({
  id: `row-${index}`,
  role: "user" as const,
  content: `Reading marker ${index}. This static row measures scroll restoration.`,
}));

function Row({ message }: { message: { id: string; content: unknown } }) {
  return (
    <div
      data-probe-row={message.id}
      style={{ height: 120, boxSizing: "border-box", padding: 16 }}
    >
      {String(message.content)}
    </div>
  );
}

function Fixture() {
  const [hidden, setHidden] = useState(false);
  const [tick, setTick] = useState(0);
  const mode = new URLSearchParams(window.location.search).get("probeMode") === "none"
    ? "none"
    : "pin-to-bottom";
  return (
    <>
      <div style={{ height: 48 }}>
        <button data-testid="hide" onClick={() => setHidden(true)}>Hide</button>
        <button data-testid="show" onClick={() => setHidden(false)}>Show</button>
        <button data-testid="rerender" onClick={() => setTick((value) => value + 1)}>Re-render</button>
      </div>
      <div
        id="probe-host"
        data-tick={tick}
        style={{ display: hidden ? "none" : "block", height: 600, width: 720 }}
      >
        <CopilotKitProvider runtimeUrl="http://127.0.0.1:6006/__probe_runtime">
          <CopilotChatConfigurationProvider threadId="hidden-container-7414">
            <CopilotChatView
              autoScroll={mode}
              messages={[...messages]}
              messageView={{ userMessage: Row }}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>
      </div>
    </>
  );
}

const meta = {
  title: "Probes/HiddenContainer7414",
  parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = { render: () => <Fixture /> };
