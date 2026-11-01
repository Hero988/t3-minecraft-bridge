# Research and compatibility

Research date: **2026-11-01**. This document identifies the primary sources used to choose an integration that can actually be implemented and built.

## Minecraft / Forge port (v1.1.0)

The current release targets **Java Edition 1.20.1 with Minecraft Forge**, as requested. The original Fabric 1.21.1 release remains available at tag `v1.0.0`; its test results do not stand in for the Forge port.

Forge's [1.20.1 getting-started guide](https://docs.minecraftforge.net/en/1.20.1/gettingstarted/) specifies Java 17. The [side separation guide](https://docs.minecraftforge.net/en/1.20.1/concepts/sides/) explains physical client/server separation. The mod uses Forge events and Mojang's official mappings, without mixins or Fabric dependencies:

- [`RegisterClientCommandsEvent`](https://github.com/MinecraftForge/MinecraftForge/blob/1.20.x/src/main/java/net/minecraftforge/client/event/RegisterClientCommandsEvent.java): client-only `/t3` commands with Brigadier `CommandSourceStack`.
- [`ClientChatReceivedEvent.Player`](https://github.com/MinecraftForge/MinecraftForge/blob/1.20.x/src/main/java/net/minecraftforge/client/event/ClientChatReceivedEvent.java): optional player-chat capture; system messages are excluded.
- `TickEvent.ClientTickEvent` at phase `END`: game-thread scheduling and public output.
- [`ClientPlayerNetworkEvent.LoggingOut`](https://github.com/MinecraftForge/MinecraftForge/blob/1.20.x/src/main/java/net/minecraftforge/client/event/ClientPlayerNetworkEvent.java): disconnect cleanup.

The `@Mod` entrypoint uses `DistExecutor.safeRunWhenOn` to isolate client classes. Forge metadata marks the mod client-only and accepts servers without the mod. Public messages go through `ClientPacketListener.sendChat`; the mod never calls `sendCommand`.

Build pins: Minecraft `1.20.1`, Forge `47.4.28` (the recommended version reported by Forge's [promotion metadata](https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json) when checked), ForgeGradle `6.0.54`, official mappings `1.20.1`, Gradle `8.12`, Java `17`. Configuration follows the official Forge `1.20.1-47.4.28` MDK and [ForgeGradle 6 documentation](https://docs.minecraftforge.net/en/fg-6.x/).

The checked-in Gradle wrapper jar was verified against Gradle's published SHA-256 `2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046`; the distribution ZIP checksum is pinned. Wrapper files retain their Apache-2.0 license in `gradle/wrapper/LICENSE`.

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
