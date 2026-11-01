import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadConfig, privateJson } from '../config.mjs';
import { runProcess } from '../t3.mjs';

test('init creates matching private configs without printing a token and refuses overwrite', async t => {
  const directory = await mkdtemp(join(tmpdir(), 't3mc-init-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(directory, 'bridge/config.json');
  const instance = join(directory, 'Minecraft Instance With Spaces');
  const args = ['--config', configPath, 'init', '--thread', 'test-thread', '--minecraft-dir', instance];
  const result = await runProcess([process.execPath, resolve('bridge/cli.mjs')], args);
  assert.equal(result.code, 0);
  const config = await loadConfig(configPath);
  const mod = JSON.parse(await readFile(join(instance, 'config/t3minecraft.json'), 'utf8'));
  assert.equal(config.token, mod.token);
  assert.equal(mod.bridgeUrl, `http://127.0.0.1:${config.port}`);
  assert.ok(!result.stdout.includes(config.token));
  if (process.platform !== 'win32') {
    assert.equal((await stat(configPath)).mode & 0o777, 0o600);
    assert.equal((await stat(join(instance, 'config/t3minecraft.json'))).mode & 0o777, 0o600);
  }
  const again = await runProcess([process.execPath, resolve('bridge/cli.mjs')], args);
  assert.equal(again.code, 1);
  assert.match(again.stderr, /already exists/);
  assert.equal((await loadConfig(configPath)).token, config.token);
});

test('config rejects executable shell strings, invalid tokens, invalid ports, and unsafe ids', async t => {
  const directory = await mkdtemp(join(tmpdir(), 't3mc-config-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'config.json');
  const base = { port: 37123, token: 'a'.repeat(64), threadId: 'thread-1', t3Command: ['t3'], timeoutMs: 180000 };
  for (const patch of [{ t3Command: 't3; echo bad' }, { token: 'abc' }, { port: 0 },
    { threadId: '--help' }, { timeoutMs: 1 }, { t3BaseDir: 123 }]) {
    await privateJson(path, { ...base, ...patch });
    await assert.rejects(loadConfig(path));
  }
  await writeFile(path, 'not-json');
  await assert.rejects(loadConfig(path));
});
