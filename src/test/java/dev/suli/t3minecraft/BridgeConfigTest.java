package dev.suli.t3minecraft;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;

class BridgeConfigTest {
    @TempDir Path directory;

    private Path config(String url, String token) throws IOException {
        return Files.writeString(directory.resolve("t3minecraft.json"),
                "{\"bridgeUrl\":\"" + url + "\",\"token\":\"" + token + "\"}");
    }

    @Test
    void acceptsGeneratedLoopbackConfiguration() throws IOException {
        BridgeConfig result = BridgeConfig.load(config("http://127.0.0.1:37123", "a".repeat(64)));
        assertEquals("http://127.0.0.1:37123", result.bridgeUrl());
    }

    @Test
    void refusesCredentialExfiltrationViaRemoteHostsAndAmbiguousUrls() {
        for (String url : new String[]{"https://example.com:37123", "http://example.com:37123",
                "http://127.0.0.1:37123@evil.example:37123", "http://127.0.0.1:37123/path",
                "http://127.0.0.1:37123?x=y", "http://127.0.0.1:37123#fragment", "http://127.0.0.1:80"}) {
            assertThrows(IOException.class, () -> BridgeConfig.load(config(url, "a".repeat(64))));
        }
    }

    @Test
    void missingMalformedOrOversizedConfigDoesNotConnect() throws IOException {
        assertThrows(IOException.class, () -> BridgeConfig.load(directory.resolve("missing.json")));
        assertThrows(IOException.class, () -> BridgeConfig.load(config("http://127.0.0.1:37123", "bad")));
        Path path = Files.writeString(directory.resolve("t3minecraft.json"), "null");
        assertThrows(IOException.class, () -> BridgeConfig.load(path));
        Files.writeString(path, "x".repeat(5000));
        assertThrows(IOException.class, () -> BridgeConfig.load(path));
    }
}
