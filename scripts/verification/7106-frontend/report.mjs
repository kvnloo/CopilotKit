import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const names = [
  'baseline normal executor preserves ordinary work and the human result',
  'baseline Strict Mode preserves ordinary work and the human result',
  'standard interrupt follow-up addresses the original gates',
];
const errors = (t) => (t.failureMessages ?? []).join('\n');
const tests = (report) => (report.testResults ?? []).flatMap(f => f.assertionResults ?? []);
const get = (report, name) => {
  const found = tests(report).filter(t => t.title === name || t.fullName?.endsWith(name));
  assert.equal(found.length, 1, `Missing/duplicate test: ${name}`);
  return found[0];
};
export function classify(report, exitCode) {
  assert.equal(report.numTotalTests, 3, 'All three real integration cases must be discovered');
  for (const name of names.slice(0, 2)) assert.equal(get(report, name).status, 'passed', 'BASELINE_BLOCKED: '+name);
  const contract = get(report, names[2]);
  if (contract.status === 'passed') {
    assert.equal(report.numFailedTests, 0);
    assert.equal(exitCode, 0);
    return { baseline: 'passed', standardInterruptContract: 'passed' };
  }
  assert.equal(contract.status, 'failed');
  assert.equal(report.numFailedTests, 1);
  assert.notEqual(exitCode, 0);
  assert.match(errors(contract), /STANDARD_FOLLOWUP_MUST_ADDRESS_INTERRUPTS/,
    'Unexpected failure: do not relabel setup/render/transport failure as the targeted resume gap');
  return { baseline: 'passed', standardInterruptContract: 'missing-addressed-resume',
    productReadiness: 'NOT established; this is a measured compatibility gap, not a fix' };
}
export function classifyNegative(report, exitCode) {
  assert.notEqual(exitCode, 0);
  assert.equal(report.numFailedTests, 1);
  const baseline = get(report, names[0]);
  assert.equal(baseline.status, 'failed');
  assert.match(errors(baseline), /ORDINARY_WORK_MUST_EXECUTE_ONCE/);
  return 'placeholder fixture cannot masquerade as completed ordinary frontend work';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--self-test') {
    const fake = (statuses, marker = '') => ({
      numTotalTests: 3, numFailedTests: statuses.filter(s => s === 'failed').length,
      testResults: [{ assertionResults: names.map((title, i) => ({title,status:statuses[i],failureMessages:[marker]})) }],
    });
    assert.equal(classify(fake(['passed','passed','passed']), 0).standardInterruptContract, 'passed');
    assert.equal(classify(fake(['passed','passed','failed'],'STANDARD_FOLLOWUP_MUST_ADDRESS_INTERRUPTS'), 1).standardInterruptContract, 'missing-addressed-resume');
    assert.throws(() => classify(fake(['passed','passed','failed'],'module missing'),1));
    assert.throws(() => classify(fake(['passed','pending','failed'],'STANDARD_FOLLOWUP_MUST_ADDRESS_INTERRUPTS'),1));
    assert.throws(() => classify({...fake(['passed','passed','passed']),numTotalTests:0},0));
    classifyNegative(fake(['failed','pending','pending'],'ORDINARY_WORK_MUST_EXECUTE_ONCE'),1);
    assert.throws(() => classifyNegative(fake(['passed','pending','pending']),0));
    console.log('7 report-classifier self-checks passed (synthetic reports only, not UI tests).');
  } else {
    const dir = process.argv[2];
    const read = name => JSON.parse(fs.readFileSync(path.join(dir,name),'utf8'));
    const result = classify(read('lifecycle.json'), Number(fs.readFileSync(path.join(dir,'lifecycle.exit'),'utf8')));
    result.negativeControl = classifyNegative(read('negative.json'),Number(fs.readFileSync(path.join(dir,'negative.exit'),'utf8')));
    result.subject = 'eef659193309a8a4fc508289e87c2b80eff46a83';
    result.scope = 'React/jsdom hooks/core/executor, fixture AG-UI stream; no Python/HTTP/browser/durable effects.';
    fs.writeFileSync(path.join(dir,'receipt.json'),JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result,null,2));
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Frontend execution characterization\n\n```json\n'+JSON.stringify(result,null,2)+'\n```\n');
  }
}
