package dev.suli.t3minecraft;

/** Keep agent output literal and keep public messages inside Minecraft's packet limit. */
public final class ChatSafety {
    private ChatSafety() {}

    public static String literal(String input) {
        if (input == null) return "";
        StringBuilder result = new StringBuilder();
        input.codePoints().filter(cp -> cp != 0x00a7 && !Character.isISOControl(cp)
                && Character.getType(cp) != Character.FORMAT
                && Character.getType(cp) != Character.SURROGATE)
                .forEach(result::appendCodePoint);
        return result.toString();
    }

    public static String publicMessage(String input) {
        String result = "[T3] " + literal(input.replace('\n', ' ').replace('\r', ' ')).replaceAll("\\s+", " ").trim();
        if (result.length() > 256) {
            int end = Character.isHighSurrogate(result.charAt(254)) ? 254 : 255;
            result = result.substring(0, end) + "…";
        }
        // The fixed prefix prevents slash-command execution, even for malicious output.
        return result;
    }
}
