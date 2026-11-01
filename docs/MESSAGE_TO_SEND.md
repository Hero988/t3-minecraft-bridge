Hey — I built it and put the full source here:

https://github.com/Hero988/t3-minecraft-bridge

Downloads: https://github.com/Hero988/t3-minecraft-bridge/releases/latest

It’s a client-side Forge mod for **Minecraft Java 1.20.1**, with a small local bridge to your existing **T3 Code thread**. You can use `/t3 ask` to talk to your agent in-game, `/t3 feed` to give it information immediately, and `/t3 note` to save information for future requests. You can also share your inventory, position, health, and targeted block with `/t3 snapshot` or `/t3 context on`.

Replies are private by default. `/t3 public on` lets the agent’s answers appear in normal Minecraft chat through your player account, with a `[T3]` prefix. The agent can also speak from a running T3 turn using the included `say` command. Optional `/t3 listen on` includes recent player chat as context when you ask a question; other players don’t automatically trigger your coding agent.

Setup is in the README: install Forge 47.4.28+ and the mod, run the bridge’s `init` with your T3 thread ID and Minecraft instance folder, start the bridge, then `/t3 connect`. It uses the model/settings already selected in T3, so there’s no separate AI API key for the mod. It needs Java 17, Node 22+, and a compatible T3 CLI; I checked T3 0.1.6. The Minecraft server doesn’t need a plugin.

The jar builds, 22 automated tests pass, and I tested the mod in a real Minecraft world with the local bridge, including context, notes, chat capture, and public/private speech. That runtime round trip used a T3 reply fixture; the real T3 CLI passed authentication and thread-read checks. The first real provider reply from Minecraft still needs checking on your own setup. The repo includes the exact validation notes, troubleshooting, privacy details, and build instructions. It’s open source under MIT.
