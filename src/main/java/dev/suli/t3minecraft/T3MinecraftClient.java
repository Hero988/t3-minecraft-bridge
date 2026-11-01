package dev.suli.t3minecraft;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.world.item.ItemStack;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.ChatFormatting;
import net.minecraft.world.phys.BlockHitResult;
import net.minecraft.world.phys.HitResult;
import net.minecraftforge.client.event.ClientChatReceivedEvent;
import net.minecraftforge.client.event.ClientPlayerNetworkEvent;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.fml.loading.FMLPaths;
import java.util.ArrayDeque;
import java.util.Queue;
import java.util.UUID;
import java.util.function.Consumer;
import static net.minecraft.commands.Commands.argument;
import static net.minecraft.commands.Commands.literal;

public final class T3MinecraftClient {
    private final Minecraft client = Minecraft.getInstance();
    private final ArrayDeque<String> recentChat = new ArrayDeque<>();
    private final Queue<String> publicQueue = new ArrayDeque<>();
    private BridgeTransport transport;
    private String session;
    private boolean connected, publicChat, listening, shareContext, polling;
    private long cursor, nextPoll, nextPublic;
    private int failures;

    public static void initialize() { new T3MinecraftClient().registerEvents(); }

    private void registerEvents() {
        MinecraftForge.EVENT_BUS.addListener(this::registerCommands);
        MinecraftForge.EVENT_BUS.addListener(this::onLogout);
        MinecraftForge.EVENT_BUS.addListener(this::onTick);
        MinecraftForge.EVENT_BUS.addListener(this::onChat);
    }

    private void registerCommands(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(literal("t3").executes(ctx -> help())
                .then(literal("help").executes(ctx -> help()))
                .then(literal("connect").executes(ctx -> connect()))
                .then(literal("disconnect").executes(ctx -> { disconnect(); local("Disconnected."); return 1; }))
                .then(literal("status").executes(ctx -> status()))
                .then(literal("ask").then(argument("text", StringArgumentType.greedyString())
                    .executes(ctx -> ask("ask", StringArgumentType.getString(ctx, "text"), false))))
                .then(literal("feed").then(argument("text", StringArgumentType.greedyString())
                    .executes(ctx -> ask("feed", StringArgumentType.getString(ctx, "text"), false))))
                .then(literal("note").then(argument("text", StringArgumentType.greedyString())
                    .executes(ctx -> note(StringArgumentType.getString(ctx, "text")))))
                .then(literal("clear-notes").executes(ctx -> notesRequest(null)))
                .then(literal("snapshot").executes(ctx -> ask("feed", "Here is my current Minecraft snapshot.", true)))
                .then(toggle("public", enabled -> {
                    publicChat = enabled;
                    if (!enabled) publicQueue.clear();
                    local(enabled ? "Public replies ON for this world. Other players will see T3's replies as your chat messages."
                            : "Public replies OFF. T3 replies stay private.");
                }))
                .then(toggle("listen", enabled -> {
                    listening = enabled;
                    recentChat.clear();
                    local(enabled ? "Listening ON. The last 20 player chat lines will accompany your next T3 request."
                            : "Listening OFF. Captured chat cleared.");
                }))
                .then(toggle("context", enabled -> {
                    shareContext = enabled;
                    local(enabled ? "Context sharing ON: position, dimension, health, inventory, and targeted block."
                            : "Context sharing OFF.");
                })));
    }

    private void onLogout(ClientPlayerNetworkEvent.LoggingOut event) { disconnect(); }

    private void onTick(TickEvent.ClientTickEvent event) {
        if (event.phase == TickEvent.Phase.END) tick();
    }

    private void onChat(ClientChatReceivedEvent.Player event) {
        String text = event.getMessage().getString();
        if (!connected || !listening || text.contains("[T3]")) return;
        String line = ChatSafety.literal(text);
        recentChat.add(line.substring(0, Math.min(1000, line.length())));
        while (recentChat.size() > 20) recentChat.removeFirst();
    }

    private LiteralArgumentBuilder<CommandSourceStack> toggle(String name, Consumer<Boolean> setter) {
        return literal(name)
                .then(literal("on").executes(ctx -> {
                    if (!requireConnected()) return 0;
                    setter.accept(true); return 1;
                }))
                .then(literal("off").executes(ctx -> {
                    setter.accept(false); return 1;
                }));
    }

    private int help() {
        local("/t3 connect | disconnect | status");
        local("/t3 ask <question> — ask your T3 thread");
        local("/t3 feed <information> — send information to T3 now");
        local("/t3 note <text> | clear-notes — save notes for future requests");
        local("/t3 snapshot — explicitly send one player snapshot");
        local("/t3 public on|off — allow public replies (default off)");
        local("/t3 context on|off | listen on|off — optional sharing");
        return 1;
    }

    private int connect() {
        if (client.player == null) { local("Join a world first."); return 0; }
        if (session != null) { local("Already connected or connecting. Use /t3 disconnect to reset."); return 0; }
        try {
            transport = new BridgeTransport(BridgeConfig.load(FMLPaths.CONFIGDIR.get().resolve("t3minecraft.json")));
        } catch (Exception e) { local(e.getMessage()); return 0; }
        session = UUID.randomUUID().toString();
        String captured = session;
        transport.request("state", state()).whenComplete((result, error) -> client.execute(() -> {
            if (!captured.equals(session)) return;
            if (error != null) { local(BridgeTransport.errorMessage(error)); disconnect(); return; }
            connected = true;
            cursor = result.get("cursor").getAsLong();
            failures = 0;
            nextPoll = 0;
            local("Connected to T3. Replies are private. Use /t3 ask <question>. Sharing options start OFF.");
        }));
        return 1;
    }

    private void disconnect() {
        if (session != null && transport != null) {
            JsonObject data = new JsonObject();
            data.addProperty("session", session);
            transport.request("disconnect", data).exceptionally(error -> null);
        }
        session = null;
        connected = publicChat = listening = shareContext = polling = false;
        recentChat.clear();
        publicQueue.clear();
        cursor = 0;
    }

    private boolean requireConnected() {
        if (connected && client.player != null) return true;
        local("Use /t3 connect in your current world first.");
        return false;
    }

    private int ask(String kind, String text, boolean snapshot) {
        if (!requireConnected()) return 0;
        if (text.length() > 2000) { local("Keep requests under 2000 characters."); return 0; }
        JsonObject data = new JsonObject();
        data.addProperty("session", session);
        data.addProperty("requestId", UUID.randomUUID().toString());
        data.addProperty("kind", kind);
        data.addProperty("text", text);
        if (snapshot || shareContext) data.add("context", snapshot());
        JsonArray chat = new JsonArray();
        if (listening) recentChat.forEach(chat::add);
        data.add("recentChat", chat);
        String captured = session;
        transport.request("ask", data).whenComplete((result, error) -> client.execute(() -> {
            if (!captured.equals(session)) return;
            local(error == null ? "Sent to T3. Waiting for a reply…" : BridgeTransport.errorMessage(error));
        }));
        return 1;
    }

    private int note(String text) {
        if (text.length() > 2000) { local("Keep notes under 2000 characters."); return 0; }
        return notesRequest(text);
    }

    private int notesRequest(String text) {
        if (!requireConnected()) return 0;
        JsonObject data = new JsonObject();
        if (text == null) data.addProperty("clear", true);
        else data.addProperty("text", text);
        String captured = session;
        transport.request("notes", data).whenComplete((result, error) -> client.execute(() -> {
            if (!captured.equals(session)) return;
            local(error == null ? "Saved notes: " + result.get("notes").getAsInt()
                    + "/32. Notes accompany future requests; clearing does not erase T3 history."
                    : BridgeTransport.errorMessage(error));
        }));
        return 1;
    }

    private int status() {
        local("Bridge " + (connected ? "connected" : "disconnected")
                + "; public=" + publicChat + "; context=" + shareContext + "; listen=" + listening);
        if (!connected) return 1;
        String captured = session;
        transport.request("status", null).whenComplete((result, error) -> client.execute(() -> {
            if (!captured.equals(session)) return;
            local(error == null ? "T3 busy=" + result.get("busy").getAsBoolean()
                    + ", queued=" + result.get("queued").getAsInt() + ", notes=" + result.get("notes").getAsInt()
                    : BridgeTransport.errorMessage(error));
        }));
        return 1;
    }

    private JsonObject state() {
        JsonObject data = new JsonObject();
        data.addProperty("session", session);
        if (shareContext) data.add("context", snapshot());
        JsonObject permissions = new JsonObject();
        permissions.addProperty("publicChat", publicChat);
        permissions.addProperty("context", shareContext);
        permissions.addProperty("listen", listening);
        data.add("permissions", permissions);
        return data;
    }

    private void tick() {
        if (!connected || client.player == null || client.level == null) return;
        long now = System.currentTimeMillis();
        if (publicChat && !publicQueue.isEmpty() && now >= nextPublic && client.getConnection() != null) {
            client.getConnection().sendChat(publicQueue.remove());
            nextPublic = now + 3000;
        }
        if (polling || now < nextPoll) return;
        polling = true;
        nextPoll = now + 1000;
        String captured = session;
        BridgeTransport capturedTransport = transport;
        long capturedCursor = cursor;
        // Refresh the lease before reading events. All game reads happen on this main thread.
        capturedTransport.request("state", state())
                .thenCompose(result -> capturedTransport.request("events?after="
                        + (result.get("newSession").getAsBoolean() ? 0 : capturedCursor) + "&session=" + captured, null))
                .whenComplete((result, error) -> client.execute(() -> {
                    if (!captured.equals(session)) return;
                    polling = false;
                    if (error != null) {
                        failures++;
                        if (failures == 1) local(BridgeTransport.errorMessage(error));
                        if (failures >= 3) { local("Bridge connection lost. Use /t3 connect to reconnect."); disconnect(); }
                        return;
                    }
                    failures = 0;
                    try {
                        for (JsonElement element : result.getAsJsonArray("events")) receive(element.getAsJsonObject());
                        cursor = result.get("cursor").getAsLong();
                    } catch (RuntimeException e) {
                        local("Unexpected bridge response. Check that mod and bridge versions match.");
                        disconnect();
                    }
                }));
    }

    private void receive(JsonObject event) {
        if (!session.equals(event.get("session").getAsString())) return;
        String text = event.get("text").getAsString();
        boolean error = "error".equals(event.get("kind").getAsString());
        String visibility = event.get("visibility").getAsString();
        int lines = 0;
        for (String line : text.substring(0, Math.min(8000, text.length())).split("\\R")) {
            local(line, error ? ChatFormatting.RED : ChatFormatting.AQUA);
            if (++lines >= 80) break;
        }
        boolean wantsPublic = !error && ("public".equals(visibility) || "auto".equals(visibility));
        if (wantsPublic && publicChat) {
            if (publicQueue.size() < 8) publicQueue.add(ChatSafety.publicMessage(text));
            else local("Public chat queue is full. Reply was displayed privately.");
        } else if ("public".equals(visibility)) {
            local("Public message kept private: /t3 public is OFF.");
        }
    }

    private JsonObject snapshot() {
        JsonObject data = new JsonObject();
        if (client.player == null || client.level == null) return data;
        data.addProperty("player", client.player.getGameProfile().getName());
        data.addProperty("dimension", client.level.dimension().location().toString());
        data.addProperty("x", Math.round(client.player.getX() * 10) / 10.0);
        data.addProperty("y", Math.round(client.player.getY() * 10) / 10.0);
        data.addProperty("z", Math.round(client.player.getZ() * 10) / 10.0);
        data.addProperty("health", client.player.getHealth());
        data.addProperty("food", client.player.getFoodData().getFoodLevel());
        data.addProperty("experienceLevel", client.player.experienceLevel);
        JsonArray inventory = new JsonArray();
        for (int i = 0; i < client.player.getInventory().getContainerSize(); i++) {
            ItemStack stack = client.player.getInventory().getItem(i);
            if (stack.isEmpty()) continue;
            JsonObject item = new JsonObject();
            item.addProperty("slot", i);
            item.addProperty("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
            item.addProperty("count", stack.getCount());
            inventory.add(item);
        }
        data.add("inventory", inventory);
        if (client.hitResult instanceof BlockHitResult hit && hit.getType() == HitResult.Type.BLOCK) {
            data.addProperty("targetBlock", BuiltInRegistries.BLOCK.getKey(client.level.getBlockState(hit.getBlockPos()).getBlock()).toString());
        }
        return data;
    }

    private void local(String message) { local(message, ChatFormatting.GRAY); }
    private void local(String message, ChatFormatting color) {
        if (client.player != null) client.gui.getChat()
                .addMessage(Component.literal("[T3] " + ChatSafety.literal(message)).withStyle(color));
    }
}
