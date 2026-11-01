# Release validation

**Forge release v1.1.0**, validated on **2026-11-01**, Linux x86-64, Temurin OpenJDK 17.0.21, Node 22.23.1.

## Passed

- `./gradlew build --console=plain`: compiled, reobfuscated, and packaged the Forge 1.20.1 jar and source jar; the installable jar contains Forge `META-INF/mods.toml`, exact Minecraft `[1.20.1]` metadata, and Java 17 bytecode (class version 61), with no Fabric metadata.
- **7 Java tests**: literal chat output, fixed-prefix protection against slash-command execution, Unicode/packet-length handling, loopback-only config validation, and malformed/missing/oversized config rejection.
- **15 Node tests**: authenticated real HTTP requests, browser-origin rejection, single-client leases, exact request deduplication, changed-request conflicts, late-reply isolation, discarding queued work from a disconnected world, saved-note persistence and concurrent writes, input/queue limits, private error events, T3 argument/stdin boundaries, strict reply receipts, approvals, timeout errors, output limits, and config initialization/permissions.
- `npm run check`: JavaScript syntax checks.
- Gradle wrapper jar SHA-256 matches Gradle's published wrapper checksum; the distribution ZIP checksum is pinned.
- **Real T3 0.1.6 CLI**: `thread send --help` exposes the required flags; `thread show <configured-thread> --messages 1 --json` successfully read a running local thread; bridge `doctor` passed its T3 checks without submitting a new turn.
- **Real Minecraft 1.20.1 client under Xvfb**: Forge 47.4.28 and Java 17 loaded the mod, created a single-player world, registered commands, connected to the real Node HTTP bridge, and completed a game → bridge → CLI fixture → bridge → game round trip.
- In that runtime test, a saved lighthouse note, the actual player position/dimension/health/inventory snapshot, and opt-in captured player chat all arrived in the assembled CLI prompt. The reply appeared in Minecraft's chat log.
- Terminal `say --public` reached the integrated server as a normal player chat packet with `[T3]`; automatic question replies did too after public chat was enabled. A slash-like payload remained literal prefixed text. With public chat off, a subsequent explicit public request appeared locally with the refusal notice and was absent from the server's player-chat log.
- Leaving the Forge world was checked for immediate bridge disconnection and removal of current context. The shared disconnect implementation resets all sharing/public flags. Automated tests additionally check that stale world replies cannot leak into a new session.

## Test boundary

The Minecraft runtime round trip used a local executable fixture returning T3's documented `{threadId, runId, status, reply}` JSON format. The real T3 CLI was tested for help, authentication, and thread reads. **An actual provider turn initiated from Minecraft was not run in this environment.** This avoids adding test prompts to the owner's active conversations. Use the README's first `/t3 ask` on your own configured thread to verify the provider round trip.

Windows/macOS bridge checks are included in GitHub Actions. Minecraft rendering and game UI testing were performed on Linux only. A public multiplayer server, launcher-specific modpack interactions, secure chat enforcement on a remote server, remote T3 forwarding, and other Minecraft versions were not exercised. Public chat is still subject to server permissions, filters, and cooldowns.

The headless development client had no audio device, so Minecraft disabled sound; no mod initialization or bridge errors occurred. That environment limitation does not affect the text-chat integration.

The original Fabric release has its own [v1.0.0 validation record](https://github.com/Hero988/t3-minecraft-bridge/blob/v1.0.0/docs/VALIDATION.md). Its Minecraft version and loader requirements do not apply to this Forge build.
