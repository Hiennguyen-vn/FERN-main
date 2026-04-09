package com.fern.simulator.render;

/**
 * ANSI color constants for terminal rendering.
 */
public final class AnsiColors {

    private AnsiColors() {
    }

    public static final String RESET = "\u001B[0m";
    public static final String BOLD = "\u001B[1m";
    public static final String DIM = "\u001B[2m";

    public static final String RED = "\u001B[31m";
    public static final String GREEN = "\u001B[32m";
    public static final String YELLOW = "\u001B[33m";
    public static final String BLUE = "\u001B[34m";
    public static final String MAGENTA = "\u001B[35m";
    public static final String CYAN = "\u001B[36m";
    public static final String WHITE = "\u001B[37m";

    public static final String BG_RED = "\u001B[41m";
    public static final String BG_GREEN = "\u001B[42m";
    public static final String BG_BLUE = "\u001B[44m";

    /** Returns true if stdout appears to be a terminal (not piped). */
    public static boolean isTerminal() {
        return System.console() != null;
    }

    /** Wraps text with color, only if output is a terminal. */
    public static String colored(String text, String color) {
        if (!isTerminal()) return text;
        return color + text + RESET;
    }

    public static String bold(String text) {
        return colored(text, BOLD);
    }

    public static String green(String text) {
        return colored(text, GREEN);
    }

    public static String yellow(String text) {
        return colored(text, YELLOW);
    }

    public static String red(String text) {
        return colored(text, RED);
    }

    public static String cyan(String text) {
        return colored(text, CYAN);
    }
}
