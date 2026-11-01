package dev.suli.t3minecraft;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.concurrent.CompletableFuture;

public final class BridgeTransport {
    private static final Gson GSON = new Gson();
    private final BridgeConfig config;
    private final HttpClient http = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(3)).followRedirects(HttpClient.Redirect.NEVER).build();

    public BridgeTransport(BridgeConfig config) { this.config = config; }

    public CompletableFuture<JsonObject> request(String path, JsonObject data) {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(config.bridgeUrl() + "/v1/" + path))
                .timeout(Duration.ofSeconds(5)).header("Authorization", "Bearer " + config.token())
                .header("Content-Type", "application/json");
        if (data == null) builder.GET();
        else builder.POST(HttpRequest.BodyPublishers.ofString(GSON.toJson(data)));
        return http.sendAsync(builder.build(), HttpResponse.BodyHandlers.ofString())
                .thenApply(response -> {
                    if (response.body().length() > 3_000_000) throw new BridgeException("Bridge response exceeded the size limit.");
                    JsonObject body;
                    try { body = JsonParser.parseString(response.body()).getAsJsonObject(); }
                    catch (RuntimeException e) { throw new BridgeException("The bridge returned invalid JSON."); }
                    if (response.statusCode() < 200 || response.statusCode() >= 300) {
                        throw new BridgeException(body.has("error") ? body.get("error").getAsString() : "Bridge request failed.");
                    }
                    return body;
                });
    }

    public static String errorMessage(Throwable error) {
        Throwable cause = error;
        while (cause.getCause() != null) cause = cause.getCause();
        return cause instanceof BridgeException ? cause.getMessage() : "Cannot reach the local bridge. Start it, then use /t3 connect.";
    }

    public static final class BridgeException extends RuntimeException {
        BridgeException(String message) { super(message); }
    }
}
