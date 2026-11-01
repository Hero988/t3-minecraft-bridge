# Setup details

## Requirements and placement

Run the Node bridge and Minecraft on the **same machine**. The default connection is authenticated HTTP on `127.0.0.1:37123`. The bridge invokes the local T3 CLI using `spawn` with an argument array and passes the game prompt through stdin. T3 handles its own local authentication. The bridge never reads your T3 database or copies provider credentials.

Put the mod and Fabric API in the *instance's* `mods` directory. Pass that instance's game directory to `init`. A launcher installation directory and a particular modpack instance directory are often different. Java 21 must be used by Minecraft as well as Gradle.

## Bridge configuration

`init` generates `.local/bridge.config.json`. The following example is documentation, **not a working secret**:

```json
{
  "port": 37123,
  "token": "GENERATED_BY_INIT",
  "threadId": "YOUR_THREAD_ID",
  "t3Command": ["t3"],
  "timeoutMs": 180000
}
```

Optional `t3BaseDir` selects a T3 data directory, passed to the CLI's `--base-dir`. Match the data directory used by your running server. **Never point it at an unrelated or older server's database.** `doctor` is read-only with respect to thread content, although the T3 CLI creates/revokes its own short-lived authentication session.

`t3Command` is an executable plus fixed arguments, not a shell command string. Use absolute paths if your T3 terminal has a different PATH from your normal terminal. For example:

```json
"t3Command": ["/usr/local/bin/t3"]
```

For an npm installation on Windows, invoke the JavaScript entrypoint rather than a `.cmd` launcher. `init` recognizes the standard global npm path automatically. If you use a different npm prefix, use `npm root -g` to locate it and edit:

```json
"t3Command": ["C:\\Program Files\\nodejs\\node.exe", "C:\\Users\\you\\AppData\\Roaming\\npm\\node_modules\\t3\\dist\\bin.mjs"]
```

The same approach works with a locally installed T3 package. Do not put shell syntax, tokens, or player input into `t3Command`.

Select a different bridge configuration with `--config /absolute/path/config.json` on any bridge command or set `T3MC_CONFIG`. The default configuration path is relative to the installed bridge source, so commands work from other working directories. Notes live beside that selected configuration. If a T3 agent runs in a different environment, the generated prompt's local CLI path will not be reachable there.

The mod's `<instance>/config/t3minecraft.json` contains `bridgeUrl` and `token`. It accepts only `http://127.0.0.1:PORT`, without a path, credentials, query, or fragment. Both files must use the same port/token. Stop the bridge before editing its configuration, then restart it and run `/t3 disconnect` followed by `/t3 connect`. The public/context/listen switches deliberately live only in memory and reset on disconnect.

## Common problems

| Symptom | Check |
| --- | --- |
| `/t3` is unknown | Minecraft is exactly 1.21.1, Fabric profile selected, jar and Fabric API in this instance's `mods`. |
| Missing configuration | Run `init` with the game directory for this exact instance, then `/t3 connect`. |
| Cannot reach bridge | Keep `node bridge/cli.mjs start` running. Check both port settings. Run `status`. |
| Invalid token | Restore matching config files or stop the bridge, back up/remove both files, and rerun `init`. Do not share the token. |
| T3 CLI not found | Install the matching T3 CLI or set an absolute `t3Command` array. On Windows use the JS entrypoint above. |
| CLI lacks required flags | T3 0.1.6 exposes `thread send --wait --json` and `thread show --messages --json`. Update CLI/server together if necessary. |
| `doctor` cannot read the thread | Start T3; check the thread ID and optional `t3BaseDir`. Test `t3 thread show ID --messages 1 --json` manually. |
| Agent asks permission | Answer in T3. The bridge never auto-approves. A waiting turn ends the current bridge wait; after responding, ask the agent to use `say` or submit a new in-game question. |
| Reply times out | The default wait is 180 seconds; edit `timeoutMs` up to 900000. The T3 turn may still run after the CLI is stopped. Check T3 before resubmitting to avoid duplicate work. |
| Public messages stay private | Enable `/t3 public on` after connecting. A `say` without `--public` always stays private. A server may still block your chat. |
| Another game session is connected | `/t3 disconnect` in the other instance or wait 15 seconds after it closes. Only one live client is supported per bridge. |
| No coordinates/inventory visible | `/t3 context on` enables ongoing sharing. `/t3 snapshot` sends one snapshot immediately, but does not enable ongoing context queries. |
| Server-wide bot responses expected | This release answers explicit `/t3 ask` and `/t3 feed` requests. Listening adds context and does not grant other players control of your agent. |

Public output is one message per agent reply, at most 256 UTF-16 code units including `[T3]`, truncated with an ellipsis. The full answer, up to 8,000 characters / 80 lines, appears locally. Public messages are spaced at least three seconds apart with an eight-message queue. Turning public off clears the queue. This cannot guarantee a particular server's anti-spam rules will accept chat.

## Remote T3 installations

The supported setup is local Minecraft + local bridge + a locally accessible T3 server/data directory. This project does not provide remote T3 pairing or credentials management. For a remote T3 machine, use an authenticated SSH setup you control and adapt `t3Command` to an executable that forwards stdin and invokes the matching CLI on that machine. A plain HTTP tunnel to T3 is insufficient because the CLI also uses local T3 runtime/auth state. Agent-side `say` then needs a separately authenticated tunnel back to the game machine and a reachable bridge source/config path. Remote forwarding is an advanced, untested deployment; do not expose the bridge port publicly.

## Updating and removal

Stop the bridge, replace the mod jar and bridge source together, and preserve your private `.local` directory. Run `doctor` after T3 updates. To remove everything, stop the bridge and delete its folder plus the mod jar and `config/t3minecraft.json` from the instance. Delete `.local/notes.json` to remove saved notes. Data already sent to T3 must be managed in T3/provider history separately.
