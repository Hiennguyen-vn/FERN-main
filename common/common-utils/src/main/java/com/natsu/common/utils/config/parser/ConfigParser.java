package com.natsu.common.utils.config.parser;

import com.natsu.common.utils.config.ConfigFormat;

import java.io.InputStream;
import java.io.OutputStream;
import java.io.Reader;
import java.io.Writer;
import java.nio.file.Path;
import java.util.Map;

/**
 * Interface for configuration parsers that can read and write configuration data
 * in different formats (YAML, JSON, TOML).
 */
public interface ConfigParser {

    /**
     * Gets the format this parser handles.
     *
     * @return the configuration format
     */
    ConfigFormat getFormat();

    /**
     * Parses configuration from a file path.
     *
     * @param path the path to the configuration file
     * @return a map representing the configuration data
     */
    Map<String, Object> parse(Path path);

    /**
     * Parses configuration from a string.
     *
     * @param content the configuration content as a string
     * @return a map representing the configuration data
     */
    Map<String, Object> parseString(String content);

    /**
     * Parses configuration from an input stream.
     *
     * @param inputStream the input stream to read from
     * @return a map representing the configuration data
     */
    Map<String, Object> parse(InputStream inputStream);

    /**
     * Parses configuration from a reader.
     *
     * @param reader the reader to read from
     * @return a map representing the configuration data
     */
    Map<String, Object> parse(Reader reader);

    /**
     * Writes configuration data to a file path.
     *
     * @param path the path to write to
     * @param data the configuration data to write
     */
    void write(Path path, Map<String, Object> data);

    /**
     * Writes configuration data to a string.
     *
     * @param data the configuration data to write
     * @return the configuration as a string
     */
    String writeToString(Map<String, Object> data);

    /**
     * Writes configuration data to an output stream.
     *
     * @param outputStream the output stream to write to
     * @param data the configuration data to write
     */
    void write(OutputStream outputStream, Map<String, Object> data);

    /**
     * Writes configuration data to a writer.
     *
     * @param writer the writer to write to
     * @param data the configuration data to write
     */
    void write(Writer writer, Map<String, Object> data);

    /**
     * Checks if this parser supports the given file path based on extension.
     *
     * @param path the file path to check
     * @return true if this parser can handle the file
     */
    default boolean supports(Path path) {
        return ConfigFormat.fromFilePath(path.toString())
                .map(format -> format == getFormat())
                .orElse(false);
    }

    /**
     * Checks if this parser supports the given file extension.
     *
     * @param extension the file extension (with or without dot)
     * @return true if this parser can handle files with this extension
     */
    default boolean supportsExtension(String extension) {
        return ConfigFormat.fromExtension(extension)
                .map(format -> format == getFormat())
                .orElse(false);
    }
}
