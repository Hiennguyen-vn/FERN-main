package com.natsu.common.utils.config;

import java.util.Arrays;
import java.util.Optional;

/**
 * Supported configuration file formats.
 */
public enum ConfigFormat {
    YAML("yml", "yaml"),
    JSON("json"),
    TOML("toml");

    private final String[] extensions;

    ConfigFormat(String... extensions) {
        this.extensions = extensions;
    }

    /**
     * Gets the primary file extension for this format.
     *
     * @return the primary extension (without dot)
     */
    public String getPrimaryExtension() {
        return extensions[0];
    }

    /**
     * Gets all supported extensions for this format.
     *
     * @return array of extensions (without dots)
     */
    public String[] getExtensions() {
        return extensions.clone();
    }

    /**
     * Detects the configuration format from a file path.
     *
     * @param filePath the file path to analyze
     * @return the detected format, or empty if unknown
     */
    public static Optional<ConfigFormat> fromFilePath(String filePath) {
        if (filePath == null || filePath.isEmpty()) {
            return Optional.empty();
        }

        String lowerPath = filePath.toLowerCase();
        for (ConfigFormat format : values()) {
            for (String ext : format.extensions) {
                if (lowerPath.endsWith("." + ext)) {
                    return Optional.of(format);
                }
            }
        }
        return Optional.empty();
    }

    /**
     * Detects the configuration format from a file extension.
     *
     * @param extension the file extension (with or without dot)
     * @return the detected format, or empty if unknown
     */
    public static Optional<ConfigFormat> fromExtension(String extension) {
        if (extension == null || extension.isEmpty()) {
            return Optional.empty();
        }

        String ext = extension.startsWith(".") ? extension.substring(1) : extension;
        String lowerExt = ext.toLowerCase();

        for (ConfigFormat format : values()) {
            if (Arrays.asList(format.extensions).contains(lowerExt)) {
                return Optional.of(format);
            }
        }
        return Optional.empty();
    }
}
