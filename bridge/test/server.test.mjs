import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../server.mjs';

async function fixture(t, ask = async () => 'Hello from the test agent') {
  const directory = await mkdtemp(join(tmpdir(), 't3mc-test-'));
  const config = { port: 0, token: 'a'.repeat(64), threadId: 'test-thread', notesPath: join(directory, 'notes.json') };
  const bridge = await createBridge(config, { ask });
  const address = await bridge.listen();
  const request = async (path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  t.after(async () => { await bridge.close(); await rm(directory, { recursive: true, force: true }); });
  return { config, bridge, request };
}

// Yield to asynchronous job completion without relying on a fixed machine speed.
async function until(get, predicate) {
  for (let i = 0; i < 100; i++) {
    const result = await get();
    if (predicate(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for bridge test state');
}

test('loopback listener authenticates every route and rejects browser origins', async t => {
  const { bridge, request } = await fixture(t);
  assert.equal(bridge.server.address().address, '127.0.0.1');
  assert.equal((await request('status')).status, 200);
  assert.equal((await request('status', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await request('context', undefined, { Authorization: '' })).status, 401);
  assert.equal((await request('status', undefined, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('missing')).status, 404);
});

test('real HTTP roundtrip carries prompt/context/notes and returns the agent reply exactly once', async t => {
  const calls = [];
  const { request } = await fixture(t, async (config, job, notes) => {
    calls.push({ job, notes });
    return 'Build your shelter before sunset.';
  });
  await request('state', { session: 'world-a' });
  await request('notes', { text: 'My base is beside a lake.' });
  const job = { session: 'world-a', requestId: 'q1', kind: 'ask', text: 'What next?',
    context: { health: 10, dimension: 'minecraft:overworld' }, recentChat: ['Alex: hello'] };
  assert.equal((await request('ask', job)).status, 202);
  assert.equal((await request('ask', job)).status, 200);
  const result = await until(() => request('events?session=world-a&after=0'), r => r.body.events?.length === 1);
  assert.equal(result.body.events[0].text, 'Build your shelter before sunset.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].notes[0].text, 'My base is beside a lake.');
  assert.equal(calls[0].job.context.health, 10);
  assert.equal((await request(`events?session=world-a&after=${result.body.cursor}`)).body.events.length, 0);
  assert.equal((await request('ask', { ...job, text: 'A different request' })).status, 409);
});

test('leaving a world prevents queued turns from starting and isolates late replies', async t => {
  let release;
  let calls = 0;
  const { request } = await fixture(t, async () => {
    calls++;
    await new Promise(resolve => { release = resolve; });
    return 'Old world reply';
  });
  await request('state', { session: 'old' });
  await request('ask', { session: 'old', requestId: 'one', text: 'First' });
  await until(() => request('status'), () => Boolean(release));
  await request('ask', { session: 'old', requestId: 'two', text: 'Second' });
  await request('disconnect', { session: 'old' });
  assert.equal((await request('state', { session: 'old' })).status, 409);
  await request('state', { session: 'new' });
  release();
  await until(() => request('status'), r => !r.body.busy);
  assert.equal(calls, 1);
  assert.equal((await request('events?session=new&after=0')).body.events.length, 0);
});

test('only one live game session can acquire the bridge', async t => {
  const { request } = await fixture(t);
  await request('state', { session: 'one' });
  assert.equal((await request('state', { session: 'two' })).status, 409);
  assert.equal((await request('ask', { session: 'two', requestId: 'q', text: 'hi' })).status, 409);
  await request('disconnect', { session: 'one' });
  assert.equal((await request('state', { session: 'two' })).status, 200);
});

test('public speech retains explicit visibility and requires an active game', async t => {
  const { request } = await fixture(t);
  assert.equal((await request('say', { text: 'Hi' })).status, 409);
  await request('state', { session: 'game', permissions: { publicChat: false } });
  await request('say', { text: '/op nobody', visibility: 'public' });
  const events = (await request('events?session=game')).body.events;
  assert.equal(events[0].visibility, 'public'); // The mod enforces the player's local gate.
  assert.equal((await request('context')).body.permissions.publicChat, false);
  assert.equal((await request('say', { text: 'x', visibility: 'command' })).status, 400);
});

test('concurrent note writes persist without loss; clear persists too', async t => {
  const { request, config } = await fixture(t);
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => request('notes', { text: `note ${i}` })));
  assert.ok(results.every(r => r.status === 200));
  const saved = JSON.parse(await readFile(config.notesPath, 'utf8'));
  assert.equal(saved.length, 10);
  assert.equal(new Set(saved.map(n => n.text)).size, 10);
  await request('notes', { clear: true });
  assert.deepEqual(JSON.parse(await readFile(config.notesPath, 'utf8')), []);
});

test('queue and input bounds return errors without launching extra turns', async t => {
  let release;
  const { request } = await fixture(t, async () => {
    await new Promise(resolve => { release = resolve; });
    return 'done';
  });
  await request('state', { session: 'game' });
  assert.equal((await request('ask', { session: 'game', requestId: 'long', text: 'x'.repeat(2001) })).status, 400);
  assert.equal((await request('notes', { text: 'x'.repeat(70000) })).status, 413);
  assert.equal((await request('ask', { session: 'game', requestId: 'chat', text: 'x', recentChat: Array(21).fill('x') })).status, 400);
  for (let i = 0; i < 4; i++) assert.equal((await request('ask', { session: 'game', requestId: `q${i}`, text: 'hi' })).status, 202);
  assert.equal((await request('ask', { session: 'game', requestId: 'overflow', text: 'hi' })).status, 429);
  await request('disconnect', { session: 'game' });
  release();
});

test('agent failures become private in-game errors; corrupted notes stop startup', async t => {
  const { request, config } = await fixture(t, async () => { throw new Error('T3 needs your approval.'); });
  await request('state', { session: 'game' });
  await request('ask', { session: 'game', requestId: 'fail', text: 'hi' });
  const result = await until(() => request('events?session=game'), r => r.body.events?.length > 0);
  assert.equal(result.body.events[0].kind, 'error');
  assert.equal(result.body.events[0].visibility, 'local');
  await request('notes', { text: 'valid' });
  // Startup restores notes from disk rather than quietly dropping them.
  const restored = await createBridge(config);
  await restored.listen();
  t.after(() => restored.close());
  const address = restored.server.address();
  const restoredStatus = await fetch(`http://127.0.0.1:${address.port}/v1/status`, {
    headers: { Authorization: `Bearer ${config.token}` },
  }).then(r => r.json());
  assert.equal(restoredStatus.notes, 1);
  await writeFile(config.notesPath, '{broken json');
  await assert.rejects(createBridge(config), /Could not load notes/);
});
