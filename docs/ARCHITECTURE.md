# Architecture and local API

## Message flow

1. The player uses `/t3 connect`. The mod loads the generated loopback URL/token, opens a random session for this connection, and acquires a 15-second bridge lease.
2. `/t3 ask`, `/t3 feed`, and `/t3 snapshot` submit an authenticated `POST /v1/ask` with a unique request ID and optional context/chat.
3. The bridge validates and queues the request (four outstanding maximum), then invokes `t3 thread send THREAD - --wait --json`. It writes the prompt to stdin. Only one CLI send runs at a time.
4. T3 queues the message behind any work already in the configured thread. It keeps its own model, settings, permissions, authentication, and history. The CLI waits for that exact run, rather than guessing which new assistant message belongs to Minecraft.
5. The bridge validates `{threadId, runId, status, reply}` from the CLI, then appends a reply/error event tagged with the originating game session.
6. Every second the mod refreshes its lease and polls events after its cursor. HTTP work is asynchronous; all game reads and chat writes happen on the Minecraft client thread.
7. Replies render as literal local text. With the local public switch enabled, automatic answers are also queued as one `[T3]` public message, at least three seconds apart. Explicit `say` messages honor their `local` or `public` visibility.

An agent can call the terminal bridge CLI's `say` command without waiting for another Minecraft question. This requires an active agent turn and terminal access in the same environment as the bridge. Ordinary T3 UI messages are not mirrored automatically.

## Lifecycle

Only one game session holds the bridge lease at a time. A game disconnect clears public output, captured chat, and all optional sharing switches. The bridge rejects late heartbeats for explicitly retired session IDs. A newly connected game gets a new ID and begins at the current event cursor, so historical replies are not replayed.

Before starting each queued T3 send, the bridge checks that its originating session is still connected. An already-running T3 turn is allowed to finish; its event remains tagged with its old session. A timeout or process shutdown stops the CLI wait, **not the actual T3 agent run**. Requests are never automatically retried after ambiguous failure.

Request IDs deduplicate up to 256 recent receipts in memory. Reusing an ID with different data returns a conflict. Events form a 256-entry in-memory ring. These are local delivery safeguards, not durable/exactly-once processing across bridge restarts. A restart loses pending events/jobs/receipts; saved notes survive. An immediate game reconnect to the restarted bridge resumes with a fresh cursor.

## HTTP interface

Every route requires `Authorization: Bearer <bridge token>`. POST bodies are JSON objects, limited to 64 KiB. No route accepts browser Origins or enables CORS. The listener always binds the IPv4 loopback address, regardless of configuration. Configuration may select the port, not a public bind host.

| Method | Route | Body/result |
| --- | --- | --- |
| GET | `/v1/status` | Version, thread ID, connection, busy flag, queue and note counts. |
| POST | `/v1/state` | `{session, context?, permissions?}`; refresh lease, return event cursor and whether session is new. |
| POST | `/v1/disconnect` | `{session}`; retire session, release its lease. |
| GET | `/v1/context` | Current opt-in context and sharing permissions, or null if disconnected. |
| POST | `/v1/ask` | `{session, requestId, kind: "ask"|"feed", text, context?, recentChat?}`; returns 202 receipt. |
| GET | `/v1/events?session=ID&after=N` | Events for that session after the cursor, plus current cursor. |
| POST | `/v1/say` | `{text, visibility: "local"|"public"}`; enqueue message for the live game. |
| POST | `/v1/notes` | `{text}` appends a note; `{clear:true}` clears saved bridge notes. |

Event shape:

```json
{
  "id": 1,
  "session": "random-game-connection-id",
  "text": "Build a shelter before sunset.",
  "kind": "reply",
  "visibility": "auto"
}
```

Errors have `kind: "error"` and `visibility: "local"`. Automatic answers use `auto`, governed by the mod's public switch. The API queues messages, not delivery acknowledgements: the terminal `say` receipt does not prove a server accepted a public chat packet.

## Source map

| File | Responsibility |
| --- | --- |
| `src/main/java/dev/suli/t3minecraft/T3MinecraftMod.java` | Forge mod entrypoint; loads client handlers only on the physical client. |
| `T3MinecraftClient.java` | Commands, context, game lifecycle, main-thread delivery and public gate. |
| `BridgeTransport.java` | Asynchronous authenticated HTTP, bounded timeouts, no redirects. |
| `BridgeConfig.java` | Validate loopback configuration before sending credentials. |
| `ChatSafety.java` | Literal text and public packet limits. |
| `bridge/server.mjs` | Authenticated routes, session leases, queue, events, persistent notes. |
| `bridge/t3.mjs` | Safe subprocess invocation, prompt assembly, exact run reply validation. |
| `bridge/cli.mjs` | Setup, diagnostics, bridge lifecycle, agent speech and external notes. |
| `bridge/config.mjs` | Private config I/O and authenticated CLI requests. |

## Non-goals

No game command execution, movement/mining automation, NPC spawning, automatic all-server chat responses, remote credential pairing, T3 database edits, or model-provider API calls. No promises of compatibility with future T3 CLI changes: the diagnostic command and strict receipt validation fail visibly when the contract changes.
