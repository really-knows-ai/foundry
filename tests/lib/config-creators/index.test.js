import test from 'node:test';
import assert from 'node:assert/strict';
import { makeCreate } from '../../../src/scripts/lib/config-creators/index.js';
import { makeAsyncMockIO } from '../../helpers/async-mock-io.js';

function makeFakeExecFile(dirtyFiles = []) {
  const calls = [];
  const fake = (argv) => {
    calls.push(argv);
    if (argv[0] === 'status') return dirtyFiles.map((f) => `?? ${f}\0`).join('');
    if (argv[0] === 'rev-parse') return 'aa11bb2\n';
    return '';
  };
  fake.calls = calls;
  return fake;
}

const VALID_BODY = `---
id: test-id
name: Test Name
---

Test body prose.
`;

test('factory: makeCreate exports a create function', () => {
  const creator = makeCreate('appraiser', 'foundry/appraisers');
  assert.equal(typeof creator.create, 'function');
});

test('factory: appraiser calls factory with correct args', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/appraisers/test.md']);
  const creator = makeCreate('appraiser', 'foundry/appraisers');
  const body = `---
id: test
name: Test
---

Test body.`;
  const out = await creator.create({ name: 'test', body, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, 'foundry/appraisers/test.md');
});

test('factory: flow calls factory with correct args', async () => {
  const io = makeAsyncMockIO({ 'foundry/cycles/draft.md': '' });
  const exec = makeFakeExecFile(['foundry/flows/myflow.md']);
  const creator = makeCreate('flow', 'foundry/flows');
  const body = `---
id: myflow
name: My Flow
starting-cycles:
  - draft
---

## Cycles

Flow body.`;
  const out = await creator.create({ name: 'myflow', body, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, 'foundry/flows/myflow.md');
});

test('factory: cycle calls factory with correct args', async () => {
  const io = makeAsyncMockIO({
    'foundry/artefacts/mytype/definition.md': '',
    'foundry/artefacts/brief/definition.md': '',
    'foundry/cycles/revise.md': '',
  });
  const exec = makeFakeExecFile(['foundry/cycles/mycycle.md']);
  const creator = makeCreate('cycle', 'foundry/cycles');
  const body = `---
id: mycycle
name: My Cycle
output-type: mytype
inputs:
  type: any-of
  artefacts:
    - brief
targets:
  - revise
---

Cycle body.`;
  const out = await creator.create({ name: 'mycycle', body, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, 'foundry/cycles/mycycle.md');
});

test('factory: artefact-type special case (artefact_type)', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/artefacts/mytype/definition.md']);
  const creator = makeCreate('artefact-type', 'foundry/artefacts', 'artefact_type');
  const body = `---
name: mytype
output-type: mytype
file-patterns:
  - 'src/**/*.ts'
---

## Definition

Artefact type body.`;
  const out = await creator.create({ name: 'mytype', body, io, execFile: exec });
  assert.equal(out.ok, true);
  assert.equal(out.path, 'foundry/artefacts/mytype/definition.md');
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /via foundry_config_create_artefact_type$/);
});

test('factory: artefact-type default underscored uses hyphen-to-underscore', async () => {
  const io = makeAsyncMockIO();
  const exec = makeFakeExecFile(['foundry/artefacts/other-type/definition.md']);
  const creator = makeCreate('artefact-type', 'foundry/artefacts');
  const body = `---
name: other-type
output-type: other-type
file-patterns:
  - 'docs/**/*.md'
---

## Definition

Artefact type body.`;
  const out = await creator.create({ name: 'other-type', body, io, execFile: exec });
  assert.equal(out.ok, true);
  const commit = exec.calls.find((c) => c[0] === 'commit');
  assert.match(commit[2], /via foundry_config_create_artefact_type$/);
});