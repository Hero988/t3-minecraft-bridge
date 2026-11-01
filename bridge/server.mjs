import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { privateJson } from './config.mjs';
import { askT3 } from './t3.mjs';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function string(value, name, max = 2000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new HttpError(400, `${name} must be nonempty text of at most ${max} characters.`);
  }
  return value.trim();
}
async function readJson(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) {
    throw new HttpError(415, 'Use Content-Type: application/json.');
  }
  let bytes = 0, chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 65536) throw new HttpError(413, 'Request exceeds 64 KiB.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch { throw new HttpError(400, 'Expected a JSON object.'); }
}

export async function createBridge(config, { ask = askT3 } = {}) {
  let notes = [];
  try {
    notes = JSON.parse(await readFile(config.notesPath, 'utf8'));
    if (!Array.isArray(notes) || notes.length > 32 || notes.some(n =>
      typeof n?.text !== 'string' || n.text.length > 2000 || typeof n.id !== 'string')) throw new Error();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not load notes.json. Restore or remove the invalid notes file.');
  }
  let game = null, serial = 0, busy = false, stopped = false;
  let noteWrites = Promise.resolve();
  const events = [], queue = [], receipts = new Map(), retiredSessions = new Set(), abort = new AbortController();
  const connected = () => game && Date.now() - game.seenAt < 15_000;
  function emit(session, text, kind = 'reply', visibility = 'auto') {
    const event = { id: ++serial, session, text, kind, visibility };
    events.push(event);
    if (events.length > 256) events.shift();
    return event;
  }
  async function drain() {
    if (busy || stopped) return;
    busy = true;
    try {
      while (queue.length && !stopped) {
        const request = queue.shift();
        // A queued message must not start a new agent turn after leaving its world.
        if (!connected() || game.session !== request.session) {
          request.status = 'discarded';
          continue;
        }
        request.status = 'running';
        try {
          const reply = await ask(config, request, notes.slice(), abort.signal);
          if (!stopped) emit(request.session, reply);
          request.status = 'completed';
        } catch (error) {
          if (!stopped) emit(request.session, error.message, 'error', 'local');
          request.status = 'error';
        }
      }
    } finally { busy = false; }
  }
  function requireSession(session) {
    if (!connected() || session !== game.session) {
      throw new HttpError(409, 'Minecraft is disconnected. Run /t3 connect in your current world.');
    }
  }
  const server = createServer(async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, {
        'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(JSON.stringify(data));
    };
    try {
      // Browsers cannot drive the bridge using a website's ambient origin.
      if (request.headers.origin) throw new HttpError(403, 'Browser origins are not accepted.');
      const header = Buffer.from(request.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${config.token}`);
      if (header.length !== expected.length || !timingSafeEqual(header, expected)) {
        throw new HttpError(401, 'Invalid bridge token.');
      }
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/v1/status') {
        return send(200, { version: '1.0.0', threadId: config.threadId, connected: Boolean(connected()),
          busy, queued: queue.length, notes: notes.length });
      }
      if (request.method === 'GET' && url.pathname === '/v1/context') {
        return send(200, { connected: Boolean(connected()), context: connected() ? game.context : null,
          permissions: connected() ? game.permissions : null });
      }
      if (request.method === 'GET' && url.pathname === '/v1/events') {
        const session = url.searchParams.get('session');
        requireSession(session);
        const after = Number(url.searchParams.get('after') || 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new HttpError(400, 'Invalid event cursor.');
        return send(200, { cursor: serial, events: events.filter(e => e.id > after && e.session === session) });
      }
      if (request.method !== 'POST') throw new HttpError(404, 'Route not found.');
      const body = await readJson(request);
      if (url.pathname === '/v1/state') {
        const session = string(body.session, 'session', 100);
        if (retiredSessions.has(session)) throw new HttpError(409, 'This Minecraft session has disconnected. Use /t3 connect again.');
        if (game && game.session !== session && connected()) {
          throw new HttpError(409, 'Another Minecraft session is connected. Disconnect it first.');
        }
        const isNew = game?.session !== session;
        game = { session, seenAt: Date.now(), context: body.context ?? null,
          permissions: { publicChat: body.permissions?.publicChat === true,
            context: body.permissions?.context === true, listen: body.permissions?.listen === true } };
        return send(200, { connected: true, cursor: serial, newSession: isNew });
      }
      if (url.pathname === '/v1/disconnect') {
        const session = string(body.session, 'session', 100);
        retiredSessions.add(session);
        if (retiredSessions.size > 256) retiredSessions.delete(retiredSessions.values().next().value);
        if (game?.session === body.session) game = null;
        return send(200, { connected: false });
      }
      if (url.pathname === '/v1/ask') {
        requireSession(body.session);
        const id = string(body.requestId, 'requestId', 100);
        const text = string(body.text, 'text');
        const kind = body.kind ?? 'ask';
        if (!['ask', 'feed'].includes(kind)) throw new HttpError(400, 'kind must be ask or feed.');
        if (body.recentChat !== undefined && (!Array.isArray(body.recentChat) ||
            body.recentChat.length > 20 || body.recentChat.some(t => typeof t !== 'string' || t.length > 1000))) {
          throw new HttpError(400, 'recentChat must contain at most 20 short chat lines.');
        }
        const fingerprint = JSON.stringify([body.session, text, kind, body.context, body.recentChat]);
        if (receipts.has(id)) {
          const prior = receipts.get(id);
          if (prior.fingerprint !== fingerprint) throw new HttpError(409, 'requestId was already used for different data.');
          return send(200, { requestId: id, status: prior.status });
        }
        if (queue.length + Number(busy) >= 4) throw new HttpError(429, 'The T3 request queue is full. Wait for a reply.');
        const job = { requestId: id, session: body.session, text, kind,
          context: body.context ?? null, recentChat: body.recentChat ?? [], status: 'queued', fingerprint };
        receipts.set(id, job);
        // Evict terminal receipts only; never lose an active request's deduplication.
        for (const [key, receipt] of receipts) {
          if (receipts.size <= 256) break;
          if (!['queued', 'running'].includes(receipt.status)) receipts.delete(key);
        }
        queue.push(job);
        send(202, { requestId: id, status: 'queued' });
        void drain();
        return;
      }
      if (url.pathname === '/v1/say') {
        if (!connected()) throw new HttpError(409, 'Minecraft is disconnected. Run /t3 connect first.');
        const text = string(body.text, 'text', 8000);
        const visibility = body.visibility ?? 'local';
        if (!['local', 'public'].includes(visibility)) throw new HttpError(400, 'visibility must be local or public.');
        return send(202, { eventId: emit(game.session, text, 'reply', visibility).id });
      }
      if (url.pathname === '/v1/notes') {
        // Serialize disk writes, including clear, so concurrent feeds cannot lose notes.
        const operation = noteWrites.then(async () => {
          let next;
          if (body.clear === true) next = [];
          else {
            const text = string(body.text, 'text');
            if (notes.length >= 32) throw new HttpError(409, '32 notes are saved. Clear notes before adding more.');
            next = [...notes, { id: randomUUID(), text }];
          }
          await privateJson(config.notesPath, next);
          notes = next;
          return { notes: notes.length };
        });
        noteWrites = operation.catch(() => {});
        return send(200, await operation);
      }
      throw new HttpError(404, 'Route not found.');
    } catch (error) {
      // Never return subprocess stderr, tokens, filesystem paths, or stack traces.
      if (!response.headersSent) send(error.status || 500, { error: error.status ? error.message : 'Bridge request failed. Check the bridge process.' });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 30;
  return {
    server,
    listen: () => new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(config.port, '127.0.0.1', () => { server.off('error', reject); accept(server.address()); });
    }),
    close: async () => {
      stopped = true;
      abort.abort();
      await noteWrites;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
