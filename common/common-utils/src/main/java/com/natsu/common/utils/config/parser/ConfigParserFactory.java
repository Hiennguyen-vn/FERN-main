package com.natsu.common.utils.config.parser;

import com.natsu.common.utils.config.ConfigFormat;
import com.natsu.common.utils.config.ConfigurationException;

import java.util.EnumMap;
import java.util.Map;
import java.util.Optional;

/**
 * Factory for creating and caching ConfigParser instances.
 */
public final class ConfigParserFactory {

    private static final Map<ConfigFormat, ConfigParser> PARSERS = new EnumMap<>(ConfigFormat.class);

    static {
        // Register default parsers
        register(new YamlConfigParser());
        register(new JsonConfigParser());
        register(new TomlConfigParser());
    }

    private ConfigParserFactory() {
        // Utility class
    }

    /**
     * Registers a parser for a specific format.
     *
     * @param parser the parser to register
     */
    public static synchronized void register(ConfigParser parser) {
        PARSERS.put(parser.getFormat(), parser);
    }

    /**
     * Gets the parser for a specific format.
     *
     * @param format the configuration format
     * @return the parser for the format
     * @throws ConfigurationException if no parser is registered for the format
     */
    public static ConfigParser getParser(ConfigFormat format) {
        ConfigParser parser = PARSERS.get(format);
        if (parser == null) {
            throw ConfigurationException.unsupportedFormat(format.name());
        }
        return parser;
    }

    /**
     * Gets the parser for a file based on its extension.
     *
     * @param filePath the file path
     * @return the appropriate parser
     * @throws ConfigurationException if the format cannot be determined or is unsupported
     */
    public static ConfigParser getParserForFile(String filePath) {
        ConfigFormat format = ConfigFormat.fromFilePath(filePath)
                .orElseThrow(() -> ConfigurationException.unsupportedFormat(
                        "Could not determine format from file: " + filePath));
        return getParser(format);
    }

    /**
     * Tries to get a parser for a specific format.
     *
     * @param format the configuration format
     * @return an Optional containing the parser, or empty if not found
     */
    public static Optional<ConfigParser> tryGetParser(ConfigFormat format) {
        return Optional.ofNullable(PARSERS.get(format));
    }

    /**
     * Checks if a parser is registered for the given format.
     *
     * @param format the configuration format
     * @return true if a parser is available
     */
    public static boolean hasParser(ConfigFormat format) {
        return PARSERS.containsKey(format);
    }

    /**
     * Gets the YAML parser.
     *
     * @return the YAML parser
     */
    public static ConfigParser yaml() {
        return getParser(ConfigFormat.YAML);
    }

    /**
     * Gets the JSON parser.
     *
     * @return the JSON parser
     */
    public static ConfigParser json() {
        return getParser(ConfigFormat.JSON);
    }

    /**
     * Gets the TOML parser.
     *
     * @return the TOML parser
     */
    public static ConfigParser toml() {
        return getParser(ConfigFormat.TOML);
    }
}
