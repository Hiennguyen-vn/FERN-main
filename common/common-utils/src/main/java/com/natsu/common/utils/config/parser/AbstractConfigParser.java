package com.natsu.common.utils.config.parser;

import com.natsu.common.utils.config.ConfigFormat;
import com.natsu.common.utils.config.ConfigurationException;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Base implementation for configuration parsers with common functionality.
 */
public abstract class AbstractConfigParser implements ConfigParser {

    protected final ConfigFormat format;

    protected AbstractConfigParser(ConfigFormat format) {
        this.format = format;
    }

    @Override
    public ConfigFormat getFormat() {
        return format;
    }

    @Override
    public Map<String, Object> parse(Path path) {
        try (Reader reader = Files.newBufferedReader(path, StandardCharsets.UTF_8)) {
            return parse(reader);
        } catch (IOException e) {
            throw ConfigurationException.loadError(path.toString(), e);
        }
    }

    @Override
    public Map<String, Object> parseString(String content) {
        try (Reader reader = new StringReader(content)) {
            return parse(reader);
        } catch (IOException e) {
            throw new ConfigurationException("Failed to parse configuration string", e);
        }
    }

    @Override
    public Map<String, Object> parse(InputStream inputStream) {
        try (Reader reader = new InputStreamReader(inputStream, StandardCharsets.UTF_8)) {
            return parse(reader);
        } catch (IOException e) {
            throw new ConfigurationException("Failed to parse configuration from input stream", e);
        }
    }

    @Override
    public void write(Path path, Map<String, Object> data) {
        try {
            // Create parent directories if they don't exist
            Path parent = path.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }
            
            try (Writer writer = Files.newBufferedWriter(path, StandardCharsets.UTF_8)) {
                write(writer, data);
            }
        } catch (IOException e) {
            throw ConfigurationException.saveError(path.toString(), e);
        }
    }

    @Override
    public String writeToString(Map<String, Object> data) {
        StringWriter writer = new StringWriter();
        write(writer, data);
        return writer.toString();
    }

    @Override
    public void write(OutputStream outputStream, Map<String, Object> data) {
        try (Writer writer = new OutputStreamWriter(outputStream, StandardCharsets.UTF_8)) {
            write(writer, data);
        } catch (IOException e) {
            throw new ConfigurationException("Failed to write configuration to output stream", e);
        }
    }

    /**
     * Creates an empty mutable map for configuration data.
     *
     * @return a new LinkedHashMap to preserve insertion order
     */
    protected Map<String, Object> createConfigMap() {
        return new LinkedHashMap<>();
    }

    /**
     * Ensures the data map is not null, returning an empty map if necessary.
     *
     * @param data the data map to check
     * @return the data map or an empty map if null
     */
    protected Map<String, Object> ensureNonNull(Map<String, Object> data) {
        return data != null ? data : createConfigMap();
    }
}
