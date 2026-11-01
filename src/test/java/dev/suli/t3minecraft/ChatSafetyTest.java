package dev.suli.t3minecraft;

import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ChatSafetyTest {
    @Test
    void agentOutputCannotBecomeASlashCommand() {
        assertEquals("[T3] /op attacker", ChatSafety.publicMessage("/op attacker"));
        assertFalse(ChatSafety.publicMessage("\n\r /kill @a").startsWith("/"));
    }

    @Test
    void stripsControlAndFormattingCharacters() {
        assertEquals("safe text", ChatSafety.literal("safe\u0000\u00a7\u202e text"));
        assertEquals("[T3] one two", ChatSafety.publicMessage("one\n\r two"));
    }

    @Test
    void enforcesPacketLimitWithoutSplittingASurrogatePair() {
        assertEquals(256, ChatSafety.publicMessage("a".repeat(500)).length());
        String unicode = ChatSafety.publicMessage("😀".repeat(300));
        assertTrue(unicode.length() <= 256);
        assertFalse(Character.isHighSurrogate(unicode.charAt(unicode.length() - 2)));
        assertTrue(unicode.endsWith("…"));
    }

    @Test
    void keepsOrdinaryUnicodeTextLiteral() {
        assertEquals("[T3] Hello 世界 😀", ChatSafety.publicMessage("Hello 世界 😀"));
    }
}
