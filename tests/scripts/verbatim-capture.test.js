/**
 * Tests for the verbatim capture mechanism — message filtering and
 * concatenation logic extracted as a pure function.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

function mid(m) {
  return m.info ? (m.info.id || '') : (m.id || '');
}

function isUserMessage(msg) {
  if (!msg.info) return false;
  return msg.info.role === 'user';
}

function simulateCapture(messages, boundaryMarker) {
  if (!Array.isArray(messages)) return '';
  if (!boundaryMarker) return '';
  const markerIdx = messages.findIndex(function(m) { return mid(m) === boundaryMarker; });
  if (markerIdx === -1) return '';
  const texts = [];
  for (let i = markerIdx + 1; i < messages.length; i++) {
    const msg = messages[i];
    if (!isUserMessage(msg)) continue;
    const parts = msg.parts || [];
    for (const p of parts) {
      if (p.type === 'text' && p.text) texts.push(p.text);
    }
  }
  return texts.join('\n');
}

function makeMessage(id, role, text) {
  return {
    info: { id: id, role: role },
    parts: [{ type: 'text', text: text }],
  };
}

function makePartsMessage(id, role, parts) {
  return {
    info: { id: id, role: role },
    parts: parts,
  };
}

test('1. Returns messages after the marker', function() {
  const messages = [
    makeMessage('msg_1', 'user', 'hello'),
    makeMessage('msg_2', 'assistant', 'ok'),
    makeMessage('msg_3', 'user', 'the artefact has a bug'),
    makeMessage('msg_4', 'user', 'fix this'),
  ];

  const result = simulateCapture(messages, 'msg_2');
  assert.equal(result, 'the artefact has a bug\nfix this');
});

test('2. Concatenates user text parts in order', function() {
  const messages = [
    makeMessage('msg_0', 'user', 'marker'),
    makeMessage('msg_1', 'user', 'a'),
    makeMessage('msg_2', 'user', 'b'),
    makeMessage('msg_3', 'user', 'c'),
  ];

  const result = simulateCapture(messages, 'msg_0');
  assert.equal(result, 'a\nb\nc');
});

test('3. Ignores non-user parts', function() {
  const messages = [
    makeMessage('msg_1', 'user', 'fix this'),
    makeMessage('msg_2', 'assistant', 'ok'),
    makeMessage('msg_3', 'user', 'and this'),
  ];

  const result = simulateCapture(messages, 'msg_1');
  assert.equal(result, 'and this');
});

test('4. Empty result when no post-marker messages', function() {
  const messages = [
    makeMessage('msg_1', 'user', 'hello'),
    makeMessage('msg_2', 'user', 'world'),
  ];

  const result = simulateCapture(messages, 'msg_2');
  assert.equal(result, '');
});

test('5. Marker message itself is excluded', function() {
  const messages = [
    makeMessage('msg_1', 'user', 'marker text'),
    makeMessage('msg_2', 'user', 'after marker'),
  ];

  const result = simulateCapture(messages, 'msg_1');
  assert.equal(result, 'after marker');
});

test('6. Empty string for non-array input', function() {
  assert.equal(simulateCapture(null, 'msg_1'), '');
  assert.equal(simulateCapture(undefined, 'msg_1'), '');
  assert.equal(simulateCapture([], 'msg_1'), '');
});

test('7. Empty string for empty boundary marker', function() {
  const messages = [makeMessage('msg_1', 'user', 'hello')];
  assert.equal(simulateCapture(messages, ''), '');
  assert.equal(simulateCapture(messages, null), '');
});
