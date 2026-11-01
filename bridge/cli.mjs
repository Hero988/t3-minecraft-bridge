#!/usr/bin/env node
import { access, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve, join } from 'node:path';
import { configPath, loadConfig, privateJson, callBridge, ROOT } from './config.mjs';
import { createBridge } from './server.mjs';
import { runProcess } from './t3.mjs';

const args = process.argv.slice(2);
function option(name) {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value.`);
  return args.splice(index, 2)[1];
}
function flag(name) {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}
function noArguments() {
  if (args.length) throw new Error(`Unexpected argument: ${args[0]}`);
}
async function exists(path) { try { await access(path); return true; } catch { return false; } }

async function main() {
  const alternate = option('--config');
  if (alternate) process.env.T3MC_CONFIG = resolve(alternate);
  const command = args.shift() || 'help';
  if (command === 'help' || command === '--help') {
    console.log(`T3 Minecraft Bridge 1.0.0 — Node 22+, Java Edition 1.21.1 / Fabric

  node bridge/cli.mjs init --thread ID --minecraft-dir PATH [--port 37123]
  node bridge/cli.mjs doctor
  node bridge/cli.mjs start
  node bridge/cli.mjs status
  node bridge/cli.mjs context
  node bridge/cli.mjs say "Hello from T3" [--public]
  node bridge/cli.mjs feed "Remember this for future Minecraft requests"
  node bridge/cli.mjs feed --file ./my-notes.txt
  node bridge/cli.mjs clear-notes

Use --config PATH on any command to select another configuration.
init refuses to overwrite existing files. Keep .local/ private.
feed saves a note; it is included in the next in-game ask or feed.
The mod's /t3 feed command sends information to T3 immediately.`);
    return;
  }
  if (command === 'init') {
    const threadId = option('--thread');
    const minecraftDir = option('--minecraft-dir');
    const port = Number(option('--port') || '37123');
    noArguments();
    if (!threadId || !minecraftDir) throw new Error('init requires --thread ID and --minecraft-dir PATH.');
    const path = configPath();
    const modPath = join(resolve(minecraftDir), 'config', 't3minecraft.json');
    if (await exists(path) || await exists(modPath)) {
      throw new Error('Configuration already exists. Back it up and remove it before initializing again, or edit it directly.');
    }
    const config = { port, token: randomBytes(32).toString('hex'), threadId,
      t3Command: ['t3'], timeoutMs: 180000 };
    // Windows npm launchers are .cmd files. Invoke the actual JS entrypoint without a shell.
    if (process.platform === 'win32' && process.env.APPDATA) {
      const entrypoint = join(process.env.APPDATA, 'npm/node_modules/t3/dist/bin.mjs');
      if (await exists(entrypoint)) config.t3Command = [process.execPath, entrypoint];
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(threadId) ||
        !Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error('Check the thread id and port (1024–65535).');
    }
    await privateJson(path, config);
    await privateJson(modPath, { bridgeUrl: `http://127.0.0.1:${port}`, token: config.token });
    console.log(`Created ${path}\nCreated ${modPath}\nRun doctor, then start. In a Minecraft world, run /t3 connect.`);
    return;
  }
  const config = await loadConfig();
  if (command === 'start') {
    noArguments();
    const bridge = await createBridge(config);
    await bridge.listen();
    console.log(`T3 Minecraft Bridge listening on 127.0.0.1:${config.port}\nThread: ${config.threadId}\nIn Minecraft: /t3 connect. Press Ctrl+C to stop.`);
    let stopping = false;
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      await bridge.close();
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    return;
  }
  if (command === 'doctor') {
    noArguments();
    const help = await runProcess(config.t3Command, ['thread', 'send', '--help'], { timeoutMs: 30000 });
    if (help.code !== 0 || !help.stdout.includes('--wait') || !help.stdout.includes('--json')) {
      throw new Error('This T3 CLI lacks the required thread send interface. Install t3 0.1.6 or newer, matching your T3 server.');
    }
    console.log('T3 CLI supports thread send --wait --json.');
    const showArgs = ['thread', 'show', config.threadId, '--messages', '1', '--json'];
    if (config.t3BaseDir) showArgs.push('--base-dir', config.t3BaseDir);
    const shown = await runProcess(config.t3Command, showArgs, { timeoutMs: 30000 });
    let value;
    try { value = JSON.parse(shown.stdout); } catch { /* Report a safe diagnostic below. */ }
    if (shown.code !== 0 || value?.thread?.threadId !== config.threadId) {
      throw new Error('The configured thread could not be read. Start T3 and check threadId, CLI/server versions, and t3BaseDir if used.');
    }
    console.log('T3 thread is readable. No agent turn was started.');
    try {
      const status = await callBridge(config, 'status');
      console.log(`Bridge reachable; Minecraft ${status.connected ? 'connected' : 'disconnected'}.`);
    } catch { console.log('Bridge is not running yet. Start it with: node bridge/cli.mjs start'); }
    return;
  }
  if (command === 'status' || command === 'context') {
    noArguments();
    console.log(JSON.stringify(await callBridge(config, command), null, 2));
    return;
  }
  if (command === 'say') {
    const publicChat = flag('--public');
    if (args.some(a => a.startsWith('--'))) throw new Error('Unknown say option.');
    const text = args.join(' ');
    if (!text.trim()) throw new Error('say requires a message.');
    const result = await callBridge(config, 'say', { text, visibility: publicChat ? 'public' : 'local' });
    console.log(`Queued Minecraft message ${result.eventId}. Delivery requires a connected mod; public messages require /t3 public on.`);
    return;
  }
  if (command === 'feed') {
    const file = option('--file');
    if (file && args.length) throw new Error('Use either text or --file, not both.');
    let text;
    if (file) {
      const data = await readFile(resolve(file));
      if (data.length > 8000) throw new Error('Note file exceeds 8 KiB. Split it into smaller notes.');
      text = data.toString('utf8');
    } else text = args.join(' ');
    if (!text.trim() || text.length > 2000) throw new Error('A note must contain 1–2000 characters.');
    const result = await callBridge(config, 'notes', { text });
    console.log(`Saved note ${result.notes}/32. It will be included in the next Minecraft request.`);
    return;
  }
  if (command === 'clear-notes') {
    noArguments();
    await callBridge(config, 'notes', { clear: true });
    console.log('Saved bridge notes cleared. Existing T3 conversation history is unchanged.');
    return;
  }
  throw new Error(`Unknown command: ${command}. Run node ${join(ROOT, 'bridge/cli.mjs')} help`);
}

main().catch(error => {
  console.error(error.code === 'ENOENT'
    ? 'Configuration was not found. Run node bridge/cli.mjs init --thread ID --minecraft-dir PATH first.'
    : error.message);
  process.exitCode = 1;
});
