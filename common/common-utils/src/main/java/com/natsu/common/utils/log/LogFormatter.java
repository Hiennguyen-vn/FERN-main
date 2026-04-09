package com.natsu.common.utils.log;

import java.io.PrintWriter;
import java.io.StringWriter;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Utility class for formatting log messages and events.
 */
public final class LogFormatter {

    /**
     * ANSI color codes for terminal output.
     */
    public static final String ANSI_RESET = "\u001B[0m";
    public static final String ANSI_BLACK = "\u001B[30m";
    public static final String ANSI_RED = "\u001B[31m";
    public static final String ANSI_GREEN = "\u001B[32m";
    public static final String ANSI_YELLOW = "\u001B[33m";
    public static final String ANSI_BLUE = "\u001B[34m";
    public static final String ANSI_PURPLE = "\u001B[35m";
    public static final String ANSI_CYAN = "\u001B[36m";
    public static final String ANSI_WHITE = "\u001B[37m";

    /**
     * Bold/Bright variants
     */
    public static final String ANSI_BOLD = "\u001B[1m";
    public static final String ANSI_DIM = "\u001B[2m";

    private static final DateTimeFormatter DEFAULT_TIMESTAMP_FORMAT =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSS").withZone(ZoneId.systemDefault());

    private LogFormatter() {
        // Utility class
    }

    /**
     * Gets the ANSI color for a log level.
     *
     * @param level the log level
     * @return the ANSI color code
     */
    public static String getColorForLevel(LogLevel level) {
        return switch (level) {
            case TRACE -> ANSI_DIM + ANSI_WHITE;
            case DEBUG -> ANSI_CYAN;
            case INFO -> ANSI_GREEN;
            case WARN -> ANSI_YELLOW;
            case ERROR -> ANSI_RED;
            case OFF -> ANSI_RESET;
        };
    }

    /**
     * Formats a message by replacing {} placeholders with arguments.
     *
     * @param message the message template
     * @param args the arguments
     * @return the formatted message
     */
    public static String formatMessage(String message, Object[] args) {
        if (message == null) {
            return "null";
        }
        if (args == null || args.length == 0) {
            return message;
        }

        StringBuilder result = new StringBuilder(message.length() + 50);
        int argIndex = 0;
        int i = 0;

        while (i < message.length()) {
            if (i + 1 < message.length() && message.charAt(i) == '{' && message.charAt(i + 1) == '}') {
                if (argIndex < args.length) {
                    result.append(formatArgument(args[argIndex++]));
                } else {
                    result.append("{}");
                }
                i += 2;
            } else {
                result.append(message.charAt(i));
                i++;
            }
        }

        return result.toString();
    }

    /**
     * Formats a single argument to a string.
     */
    private static String formatArgument(Object arg) {
        if (arg == null) {
            return "null";
        }
        if (arg instanceof Throwable) {
            return formatThrowable((Throwable) arg);
        }
        if (arg.getClass().isArray()) {
            return formatArray(arg);
        }
        return arg.toString();
    }

    /**
     * Formats an array to a string.
     */
    private static String formatArray(Object array) {
        if (array instanceof Object[]) {
            return java.util.Arrays.deepToString((Object[]) array);
        }
        if (array instanceof int[]) {
            return java.util.Arrays.toString((int[]) array);
        }
        if (array instanceof long[]) {
            return java.util.Arrays.toString((long[]) array);
        }
        if (array instanceof double[]) {
            return java.util.Arrays.toString((double[]) array);
        }
        if (array instanceof float[]) {
            return java.util.Arrays.toString((float[]) array);
        }
        if (array instanceof boolean[]) {
            return java.util.Arrays.toString((boolean[]) array);
        }
        if (array instanceof byte[]) {
            return java.util.Arrays.toString((byte[]) array);
        }
        if (array instanceof short[]) {
            return java.util.Arrays.toString((short[]) array);
        }
        if (array instanceof char[]) {
            return java.util.Arrays.toString((char[]) array);
        }
        return array.toString();
    }

    /**
     * Formats a throwable with its stack trace.
     *
     * @param throwable the throwable
     * @return the formatted stack trace
     */
    public static String formatThrowable(Throwable throwable) {
        if (throwable == null) {
            return "";
        }
        StringWriter sw = new StringWriter();
        PrintWriter pw = new PrintWriter(sw);
        throwable.printStackTrace(pw);
        return sw.toString();
    }

    /**
     * Formats a log event for console output with colors.
     *
     * @param event the log event
     * @param includeColor whether to include ANSI colors
     * @return the formatted log line
     */
    public static String formatForConsole(LogEvent event, boolean includeColor) {
        String timestamp = DEFAULT_TIMESTAMP_FORMAT.format(event.timestamp());
        String levelPadded = String.format("%-5s", event.level().getLabel());
        String formattedMessage = event.getFormattedMessage();

        StringBuilder sb = new StringBuilder();

        if (includeColor) {
            String color = getColorForLevel(event.level());
            sb.append(ANSI_DIM).append(timestamp).append(ANSI_RESET)
                    .append(" ")
                    .append(color).append("[").append(levelPadded).append("]").append(ANSI_RESET)
                    .append(" ")
                    .append(ANSI_PURPLE).append("[").append(event.threadName()).append("]").append(ANSI_RESET)
                    .append(" ")
                    .append(ANSI_BLUE).append(event.loggerName()).append(ANSI_RESET)
                    .append(" - ")
                    .append(color).append(formattedMessage).append(ANSI_RESET);
        } else {
            sb.append(timestamp)
                    .append(" [").append(levelPadded).append("]")
                    .append(" [").append(event.threadName()).append("]")
                    .append(" ").append(event.loggerName())
                    .append(" - ").append(formattedMessage);
        }

        if (event.throwable() != null) {
            sb.append(System.lineSeparator());
            if (includeColor) {
                sb.append(ANSI_RED).append(formatThrowable(event.throwable())).append(ANSI_RESET);
            } else {
                sb.append(formatThrowable(event.throwable()));
            }
        }

        return sb.toString();
    }

    /**
     * Formats a log event for file output (no colors).
     *
     * @param event the log event
     * @return the formatted log line
     */
    public static String formatForFile(LogEvent event) {
        return formatForConsole(event, false);
    }

    /**
     * Formats a timestamp using the default pattern.
     *
     * @param event the log event
     * @return the formatted timestamp
     */
    public static String formatTimestamp(LogEvent event) {
        return DEFAULT_TIMESTAMP_FORMAT.format(event.timestamp());
    }

    /**
     * Creates a custom timestamp formatter.
     *
     * @param pattern the date-time pattern
     * @return the formatter
     */
    public static DateTimeFormatter createTimestampFormatter(String pattern) {
        return DateTimeFormatter.ofPattern(pattern).withZone(ZoneId.systemDefault());
    }
}
