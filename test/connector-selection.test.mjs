import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyExclusiveConnectorRequest,
  exclusiveConnectorRequest,
  requestedConnectorIsAlreadyExclusive,
} from '../src/connector-selection.ts';

function fakeAgent() {
  const configured = [
    { configKey: 'arc1', name: 'arc1', enabled: true, isPlatform: false, config: { name: 'arc1' } },
    { configKey: 'ms365', name: 'ms365', enabled: true, isPlatform: false, config: { name: 'ms365' } },
  ];
  let live = [
    { name: 'developer', isPlatform: true, config: {} },
    { name: 'ms365', isPlatform: false, config: { name: 'ms365' } },
    { name: 'arc1', isPlatform: false, config: { name: 'arc1' } },
  ];
  return {
    configured,
    get live() { return live; },
    listExtensions: async () => configured,
    listSessionExtensions: async () => live,
    removeSessionExtension: async (name) => { live = live.filter((item) => item.name !== name); },
    addSessionExtension: async (config) => { live.push({ name: config.name, isPlatform: false, config }); },
  };
}

test('recognises explicit exclusive connector prompts', () => {
  assert.equal(exclusiveConnectorRequest('Use only ms365. Find my next meeting.'), 'ms365');
  assert.equal(exclusiveConnectorRequest('Please use only ARC-1 for this.'), 'ARC-1');
  assert.equal(exclusiveConnectorRequest('Use ms365 if useful.'), null);
});

test('does not re-query session extensions when the requested connector is already exclusive', () => {
  assert.equal(
    requestedConnectorIsAlreadyExclusive('Use only ms365. Find my next meeting.', new Set(['ms365'])),
    true
  );
  assert.equal(
    requestedConnectorIsAlreadyExclusive('Use only ms365. Find my next meeting.', new Set(['ms365', 'arc1'])),
    false
  );
  assert.equal(
    requestedConnectorIsAlreadyExclusive('Use only arc-1. List transports.', new Set(['arc1'])),
    true
  );
});

test('activates the requested connector and removes other MCP connectors', async () => {
  const agent = fakeAgent();
  const result = await applyExclusiveConnectorRequest(
    agent,
    'Use only ms365. Find my next meeting.'
  );

  assert.equal(result.requested, 'ms365');
  assert.deepEqual(agent.live.map((item) => item.name).sort(), ['developer', 'ms365']);
});

test('keeps the baked-in Microsoft 365 backend active while isolating ARC-1', async () => {
  const agent = fakeAgent();
  await applyExclusiveConnectorRequest(agent, 'Use only arc-1. List transports.');

  assert.deepEqual(agent.live.map((item) => item.name).sort(), ['arc1', 'developer', 'ms365']);
});

test('fails before sending when the requested connector is unavailable', async () => {
  const agent = fakeAgent();
  await assert.rejects(
    applyExclusiveConnectorRequest(agent, 'Use only missing. Do the work.'),
    /Connector "missing" is not available/
  );
});

test('fails visibly instead of hanging when connector discovery stalls', async () => {
  const agent = {
    listExtensions: () => new Promise(() => undefined),
  };

  await assert.rejects(
    applyExclusiveConnectorRequest(agent, 'Use only arc1. List transports.', 5),
    /Selecting connector "arc1" timed out/
  );
});
