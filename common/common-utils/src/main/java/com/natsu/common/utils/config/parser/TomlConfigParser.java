package com.natsu.common.utils.config.parser;

import com.moandjiezana.toml.Toml;
import com.moandjiezana.toml.TomlWriter;
import com.natsu.common.utils.config.ConfigFormat;
import com.natsu.common.utils.config.ConfigurationException;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.util.Map;

/**
 * Configuration parser for TOML format using toml4j.
 */
public class TomlConfigParser extends AbstractConfigParser {

    private final TomlWriter tomlWriter;

    public TomlConfigParser() {
        super(ConfigFormat.TOML);
        this.tomlWriter = createTomlWriter();
    }

    private TomlWriter createTomlWriter() {
        return new TomlWriter.Builder()
                .indentValuesBy(2)
                .indentTablesBy(2)
                .padArrayDelimitersBy(1)
                .build();
    }

    @Override
    public Map<String, Object> parse(Reader reader) {
        try {
            // Read the entire content first since Toml doesn't directly support Reader
            StringBuilder content = new StringBuilder();
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                content.append(buffer, 0, read);
            }
            return parseString(content.toString());
        } catch (IOException e) {
            throw new ConfigurationException("Failed to parse TOML configuration", e);
        }
    }

    @Override
    public Map<String, Object> parseString(String content) {
        if (content == null || content.isBlank()) {
            return createConfigMap();
        }
        try {
            Toml toml = new Toml().read(content);
            Map<String, Object> result = toml.toMap();
            return result != null ? result : createConfigMap();
        } catch (Exception e) {
            throw new ConfigurationException("Failed to parse TOML configuration string", e);
        }
    }

    @Override
    public void write(Writer writer, Map<String, Object> data) {
        try {
            tomlWriter.write(ensureNonNull(data), writer);
        } catch (IOException e) {
            throw new ConfigurationException("Failed to write TOML configuration", e);
        }
    }

    @Override
    public String writeToString(Map<String, Object> data) {
        return tomlWriter.write(ensureNonNull(data));
    }
}
