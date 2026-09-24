// Diagnostic consumer: real core response state, not a React tool executor.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ɵInterruptState } from './generated/interrupt-state.ts';

const { interrupts, replies } = JSON.parse(readFileSync(0, 'utf8'));
assert.equal(interrupts.length, 2, 'EXPECTED_TWO_PENDING_INTERRUPTS');
const state = new ɵInterruptState();
state.setStandard(interrupts);
const decisions = [];
let completed;
for (const [index, reply] of replies.entries()) {
  const decision = reply.status === 'cancelled'
    ? state.cancel(reply.interruptId)
    : state.resolve(reply.payload, reply.interruptId);
  decisions.push(decision.kind);
  if (index < replies.length - 1) {
    assert.equal(decision.kind, 'waiting', 'NO_CONTINUATION_BEFORE_ALL_ANSWERS');
  } else {
    assert.equal(decision.kind, 'resume', 'ALL_ANSWERS_MUST_CONTINUE');
    completed = decision;
  }
}
assert.deepEqual(
  [...completed.toolResults.map(x => x.toolCallId)].sort(),
  ['fe-1', 'fe-2'],
  'CLIENT_TOOL_RESULT_IDENTITIES',
);
assert.equal(new Set(completed.resume.map(x => x.interruptId)).size, 2);
assert.equal(state.resolve({ duplicated: true }, replies.at(-1).interruptId).kind, 'ignored', 'ONE_RESUME_PER_PENDING_EPOCH');
console.log(JSON.stringify({ decisions, ...completed }));
