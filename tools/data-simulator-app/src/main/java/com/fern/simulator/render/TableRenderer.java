package com.fern.simulator.render;

/**
 * Renders tabular data to the terminal with column alignment.
 */
public final class TableRenderer {

    private TableRenderer() {
    }

    /**
     * Renders a simple table with headers and rows.
     */
    public static String render(String[] headers, String[][] rows) {
        int[] widths = new int[headers.length];
        for (int i = 0; i < headers.length; i++) {
            widths[i] = headers[i].length();
        }
        for (String[] row : rows) {
            for (int i = 0; i < row.length && i < widths.length; i++) {
                widths[i] = Math.max(widths[i], row[i] != null ? row[i].length() : 0);
            }
        }

        StringBuilder sb = new StringBuilder();

        // Header
        for (int i = 0; i < headers.length; i++) {
            sb.append(String.format("%-" + widths[i] + "s", headers[i]));
            if (i < headers.length - 1) sb.append("  ");
        }
        sb.append('\n');

        // Separator
        for (int i = 0; i < headers.length; i++) {
            sb.append("─".repeat(widths[i]));
            if (i < headers.length - 1) sb.append("──");
        }
        sb.append('\n');

        // Rows
        for (String[] row : rows) {
            for (int i = 0; i < headers.length; i++) {
                String val = i < row.length && row[i] != null ? row[i] : "";
                sb.append(String.format("%-" + widths[i] + "s", val));
                if (i < headers.length - 1) sb.append("  ");
            }
            sb.append('\n');
        }

        return sb.toString();
    }
}
