# Research and compatibility

Research date: **2026-11-01**. This document identifies the primary sources used to choose an integration that can actually be implemented and built.

## Minecraft

This release targets **Java Edition 1.21.1**, a deliberate fixed target for this first version. It does not claim to target the newest Minecraft release. Fabric's [client command documentation for 1.21.1](https://docs.fabricmc.net/1.21.1/develop/commands/basics#client-commands) describes the client command registration API. The mod uses Fabric API callbacks rather than custom mixins:

- `ClientCommandRegistrationCallback` for `/t3` commands.
- `ClientReceiveMessageEvents.CHAT` for optional player-chat capture.
- `ClientTickEvents.END_CLIENT_TICK` for main-thread scheduling.
- `ClientPlayConnectionEvents.DISCONNECT` for connection cleanup.

Fabric API references: [command API](https://maven.fabricmc.net/docs/fabric-api-0.116.17+1.21.1/net/fabricmc/fabric/api/client/command/v2/package-summary.html), [message events](https://maven.fabricmc.net/docs/fabric-api-0.116.17+1.21.1/net/fabricmc/fabric/api/client/message/v1/ClientReceiveMessageEvents.html), and [lifecycle events](https://maven.fabricmc.net/docs/fabric-api-0.116.17+1.21.1/net/fabricmc/fabric/api/client/event/lifecycle/v1/ClientTickEvents.html). Artifacts are downloaded from [Fabric Maven](https://maven.fabricmc.net/).

Build pins: Minecraft `1.21.1`, Yarn `1.21.1+build.3`, Fabric Loader `0.16.14`, Fabric API `0.116.17+1.21.1`, Loom `1.10.5`, Gradle `8.12`, Java `21`. The checked-in Gradle wrapper jar was verified against Gradle's published SHA-256 `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`; the distribution ZIP checksum is enforced in the wrapper configuration. Gradle wrapper files are Apache-2.0 licensed; the license is included at `gradle/wrapper/LICENSE`.

## T3 Code

Upstream source examined at commit [`fa31b66bbb2ae5234205a8628a78e038d917202f`](https://github.com/pingdotgg/t3code/tree/fa31b66bbb2ae5234205a8628a78e038d917202f), with server package version `0.1.6`.

The [orchestrator MCP documentation](https://github.com/pingdotgg/t3code/blob/fa31b66bbb2ae5234205a8628a78e038d917202f/docs/orchestration-v2/orchestrator-mcp-server.md) describes an authenticated `/mcp` endpoint and provider session credentials. Copying a provider-session token into a Minecraft mod would create lifecycle and exposure problems. The project instead uses T3's own CLI, whose [thread implementation](https://github.com/pingdotgg/t3code/blob/fa31b66bbb2ae5234205a8628a78e038d917202f/apps/server/src/cli/thread.ts) handles short-lived local MCP sessions itself.

Verified source contract:

- `t3 thread send THREAD - --wait --json` reads prompt text from stdin.
- It sends using queue mode, preserving work already running in the thread.
- The CLI waits for the submitted run, follows its continuation when applicable, and extracts the final assistant reply from that run.
- JSON results contain `threadId`, `runId`, `status`, `reply`, and `error`.
- A waiting question/approval produces exit code `2`; unsuccessful turns exit `1`.
- `t3 thread show THREAD --messages 1 --json` provides a read-only setup check.
- `--base-dir` selects the local T3 data directory.

The installed T3 0.1.6 CLI was also exercised locally for command help and a successful JSON thread read. Automated adapter tests use an executable fixture so they never start paid agent turns or mutate a user's unrelated chat. See [validation](VALIDATION.md) for the runtime test boundary.

## Design choices

The client-only mod avoids requiring server installation. Public speech uses the player's normal signed-chat send path. Saved notes are explicit, bounded, and included in future prompts. Passive chat capture does not start autonomous turns, because a chat message from another player should not silently operate a coding agent on the owner's machine.

The bridge is independent of any provider SDK and has no npm runtime dependencies. The agent remains the selected T3 agent, with T3's existing permissions and usage limits. A future version could add other Minecraft versions or a separately reviewed remote transport without changing the local protocol.
