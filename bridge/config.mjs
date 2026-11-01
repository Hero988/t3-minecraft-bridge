import { mkdir, readFile, rename, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_CONFIG = resolve(ROOT, '.local/bridge.config.json');
export const configPath = () => resolve(process.env.T3MC_CONFIG || DEFAULT_CONFIG);

export async function privateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}

export async function loadConfig(path = configPath()) {
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (typeof config.token !== 'string' || !/^[a-f0-9]{64}$/.test(config.token)) {
    throw new Error('Invalid bridge token. Run init to generate a new configuration.');
  }
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error('Bridge port must be an integer between 1024 and 65535.');
  }
  if (typeof config.threadId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(config.threadId)) {
    throw new Error('A valid T3 thread id is required.');
  }
  if (!Array.isArray(config.t3Command) || !config.t3Command.length ||
      config.t3Command.some(part => typeof part !== 'string' || !part || part.includes('\0'))) {
    throw new Error('t3Command must be an array containing an executable and optional fixed arguments.');
  }
  if (config.t3BaseDir !== undefined && (typeof config.t3BaseDir !== 'string' || !config.t3BaseDir)) {
    throw new Error('t3BaseDir must be a nonempty path.');
  }
  if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1000 || config.timeoutMs > 900_000) {
    throw new Error('timeoutMs must be between 1000 and 900000.');
  }
  return { ...config, notesPath: resolve(dirname(path), 'notes.json'), configPath: path };
}

export async function callBridge(config, path, body) {
  const response = await fetch(`http://127.0.0.1:${config.port}/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Bridge returned HTTP ${response.status}`);
  return data;
}
