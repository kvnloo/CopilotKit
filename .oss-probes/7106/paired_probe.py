"""Pinned real Python graph <-> actual core response-state boundary.

No browser, React hook, frontend executor or remote model participates. Frontend
replies are fixture values; the backend tool and Python graph execute for real.
"""
from __future__ import annotations

import importlib.metadata
import importlib.util
import inspect
import json
import os
from pathlib import Path
import subprocess
import sys

from ag_ui.core import EventType
from ag_ui.core.types import ResumeEntry
from ag_ui_langgraph import LangGraphAgent
from langchain_core.messages import AIMessage
from langchain_core.tools import tool

ROOT = Path(__file__).resolve().parent
SUBJECT = Path(os.environ['SUBJECT_DIR']).resolve()
spec = importlib.util.spec_from_file_location(
    'author_frontend_interrupt_fixture',
    SUBJECT / 'sdk-python/tests/test_frontend_tool_interrupt.py',
)
author = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = author
spec.loader.exec_module(author)
assert 'emit_interrupt_outcome' in inspect.signature(LangGraphAgent.__init__).parameters, 'STANDARD_INTERRUPT_SUPPORT_REQUIRED_NO_SKIP'


def scenario(*, human_first=False, cancel=False, mutation=None):
    backend_runs = []

    @tool
    def counted_search(q: str) -> str:
        """A deterministic local backend operation."""
        backend_runs.append(q)
        return 'backend-result'

    graph, script = author._build(
        responses=[
            author._ai([
                {'id': 'be-1', 'name': 'counted_search', 'args': {'q': 'fixture'}},
                author._fe_call('fe-1'),
                author._fe_call('fe-2', name=author.HITL_TOOL_NAME),
            ]),
            AIMessage(content='done', id='ai-2'),
        ],
        tools=[counted_search],
    )
    before = author._run_standard(graph)
    pending = dict((call, iid) for iid, call in author._open_interrupts(before))
    assert set(pending) == {'fe-1', 'fe-2'}, 'GRAPH_MUST_EXPOSE_BOTH_FRONTEND_GATES'
    assert len(script['seen']) == 1, 'GRAPH_MUST_NOT_CONTINUE_WITH_MISSING_ANSWERS'
    assert backend_runs == ['fixture'], 'ORDINARY_BACKEND_MUST_ACTUALLY_EXECUTE'
    final_event = [e for e in before if e.type == EventType.RUN_FINISHED][-1]
    # Real Pydantic wire serialization, not hand-assembled interrupt fields.
    wire = [item.model_dump(mode='json', by_alias=True, exclude_none=True) for item in final_event.outcome.interrupts]
    if mutation == 'drop-tool-identity':
        item = next(i for i in wire if i.get('toolCallId') == 'fe-2')
        item.pop('toolCallId')

    ordinary = {'interruptId': pending['fe-1'], 'status': 'resolved', 'payload': {'page': '/x'}}
    human = {'interruptId': pending['fe-2'], 'status': 'cancelled'} if cancel else {
        'interruptId': pending['fe-2'], 'status': 'resolved', 'payload': {'approved': False},
    }
    replies = [human, ordinary] if human_first else [ordinary, human]
    process = subprocess.run(
        ['node', '--experimental-strip-types', str(ROOT / 'client-roundtrip.mjs')],
        input=json.dumps({'interrupts': wire, 'replies': replies}),
        text=True, capture_output=True, timeout=30,
    )
    if process.returncode:
        raise AssertionError('CLIENT_BOUNDARY_REJECTED\n' + process.stderr)
    decision = json.loads(process.stdout)
    assert decision['decisions'] == ['waiting', 'resume']
    entries = decision['resume']
    if mutation == 'swap-resume-targets':
        entries[0]['interruptId'], entries[1]['interruptId'] = entries[1]['interruptId'], entries[0]['interruptId']
    after = author._run_standard(
        graph, run_id='r2',
        resume=[ResumeEntry.model_validate(entry) for entry in entries],
    )
    assert author._open_interrupts(after) == [], 'GRAPH_MUST_LEAVE_NO_PENDING_GATES'
    assert len(script['seen']) == 2, 'GRAPH_MUST_CONTINUE_AFTER_REAL_RESULTS'
    assert backend_runs == ['fixture'], 'BACKEND_MUST_NOT_REEXECUTE_ON_RESUME'
    results = author._tool_messages(script['seen'][1])
    assert len(results) == 3, 'ONE_GRAPH_RESULT_PER_ORIGINAL_CALL'
    assert len({m.tool_call_id for m in results}) == 3, 'GRAPH_RESULT_IDS_MUST_BE_UNIQUE'
    by_call = {m.tool_call_id: m for m in results}
    expected_human = {'ok': False, 'error': 'cancelled'} if cancel else {'approved': False}
    assert json.loads(by_call['fe-1'].content) == {'page': '/x'}, 'GRAPH_RESULT_IDENTITY'
    assert json.loads(by_call['fe-2'].content) == expected_human, 'GRAPH_RESULT_IDENTITY'
    assert by_call['fe-2'].status == ('error' if cancel else 'success')
    assert by_call['be-1'].content == 'backend-result'
    return {
        'human_first': human_first, 'cancel': cancel,
        'client_decisions': decision['decisions'],
        'wire_interrupts': wire,
        'resume': entries,
        'client_tool_results': decision['toolResults'],
        'model_calls': len(script['seen']), 'backend_calls': len(backend_runs),
        'graph_results': [{'toolCallId': m.tool_call_id, 'name': m.name, 'content': m.content, 'status': m.status} for m in results],
    }


receipt = {'passed': [], 'negative_controls': [], 'versions': {}}
for name, kwargs in [
    ('ordinary answer then human decision', {}),
    ('human decision then ordinary answer', {'human_first': True}),
    ('human cancellation preserves ordinary completed work', {'cancel': True}),
]:
    receipt['passed'].append({'name': name, **scenario(**kwargs)})
    print('PASS', name, flush=True)
for mutation, expected in [
    ('drop-tool-identity', 'CLIENT_TOOL_RESULT_IDENTITIES'),
    ('swap-resume-targets', 'GRAPH_RESULT_IDENTITY'),
]:
    try:
        scenario(mutation=mutation)
    except AssertionError as error:
        assert expected in str(error), f'UNEXPECTED_NEGATIVE_CONTROL_FAILURE: {error}'
        receipt['negative_controls'].append({'name': mutation, 'expected_assertion': expected})
        print('EXPECTED RED', mutation, flush=True)
    else:
        raise AssertionError('NEGATIVE_CONTROL_DID_NOT_FAIL: ' + mutation)
for package in ('copilotkit', 'ag-ui-langgraph', 'ag-ui-protocol', 'langgraph', 'langchain', 'langchain-core', 'pydantic'):
    receipt['versions'][package] = importlib.metadata.version(package)
assert len(receipt['passed']) == 3 and len(receipt['negative_controls']) == 2
receipt['scope'] = 'Real Python graph, wire serialization, core interrupt aggregation and resumed graph. Fixture frontend answers; no React render/click, normal frontend executor, HTTP transport, live model or external effect guarantee.'
(ROOT / 'paired-receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
print(json.dumps({'passed': 3, 'negative_controls': 2, 'versions': receipt['versions']}, indent=2))
