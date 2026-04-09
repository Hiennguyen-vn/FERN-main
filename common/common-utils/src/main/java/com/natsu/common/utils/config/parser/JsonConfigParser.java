package com.natsu.common.utils.config.parser;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.natsu.common.utils.config.ConfigFormat;
import com.natsu.common.utils.config.ConfigurationException;

import java.io.IOException;
import java.io.Reader;
import java.io.Writer;
import java.util.Map;

/**
 * Configuration parser for JSON format using Jackson.
 */
public class JsonConfigParser extends AbstractConfigParser {

    private final ObjectMapper objectMapper;
    private static final TypeReference<Map<String, Object>> MAP_TYPE_REF = new TypeReference<>() {};

    public JsonConfigParser() {
        super(ConfigFormat.JSON);
        this.objectMapper = createObjectMapper();
    }

    public JsonConfigParser(ObjectMapper objectMapper) {
        super(ConfigFormat.JSON);
        this.objectMapper = objectMapper;
    }

    private ObjectMapper createObjectMapper() {
        ObjectMapper mapper = new ObjectMapper();
        mapper.enable(SerializationFeature.INDENT_OUTPUT);
        mapper.configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, false);
        return mapper;
    }

    @Override
    public Map<String, Object> parse(Reader reader) {
        try {
            Map<String, Object> result = objectMapper.readValue(reader, MAP_TYPE_REF);
            return result != null ? result : createConfigMap();
        } catch (IOException e) {
            throw new ConfigurationException("Failed to parse JSON configuration", e);
        }
    }

    @Override
    public Map<String, Object> parseString(String content) {
        if (content == null || content.isBlank()) {
            return createConfigMap();
        }
        try {
            Map<String, Object> result = objectMapper.readValue(content, MAP_TYPE_REF);
            return result != null ? result : createConfigMap();
        } catch (JsonProcessingException e) {
            throw new ConfigurationException("Failed to parse JSON configuration string", e);
        }
    }

    @Override
    public void write(Writer writer, Map<String, Object> data) {
        try {
            objectMapper.writeValue(writer, ensureNonNull(data));
        } catch (IOException e) {
            throw new ConfigurationException("Failed to write JSON configuration", e);
        }
    }

    @Override
    public String writeToString(Map<String, Object> data) {
        try {
            return objectMapper.writeValueAsString(ensureNonNull(data));
        } catch (JsonProcessingException e) {
            throw new ConfigurationException("Failed to write JSON configuration to string", e);
        }
    }

    /**
     * Gets the underlying ObjectMapper for advanced usage.
     *
     * @return the ObjectMapper instance
     */
    public ObjectMapper getObjectMapper() {
        return objectMapper;
    }
}
