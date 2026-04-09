package com.natsu.common.utils.config;

import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * A wrapper around configuration data providing type-safe access to configuration values.
 * Supports nested path access using dot notation (e.g., "database.connection.timeout").
 */
public class ConfigSection {

    private final Map<String, Object> data;
    private final String path;
    private final ConfigSection root;

    /**
     * Creates a new ConfigSection with the given data.
     *
     * @param data the configuration data
     */
    public ConfigSection(Map<String, Object> data) {
        this.data = data != null ? data : new LinkedHashMap<>();
        this.path = "";
        this.root = this;
    }

    /**
     * Creates a nested ConfigSection.
     *
     * @param data the configuration data
     * @param path the path to this section
     * @param root the root ConfigSection
     */
    private ConfigSection(Map<String, Object> data, String path, ConfigSection root) {
        this.data = data != null ? data : new LinkedHashMap<>();
        this.path = path;
        this.root = root;
    }

    /**
     * Gets the current path of this section.
     *
     * @return the current path, empty string for root
     */
    public String getCurrentPath() {
        return path;
    }

    /**
     * Gets the full path for a key relative to this section.
     *
     * @param key the relative key
     * @return the full path
     */
    private String getFullPath(String key) {
        return path.isEmpty() ? key : path + "." + key;
    }

    /**
     * Checks if a key exists in this section.
     *
     * @param key the key to check
     * @return true if the key exists
     */
    public boolean contains(String key) {
        return get(key) != null;
    }

    /**
     * Gets all keys in this section.
     *
     * @param deep if true, returns all keys recursively with dot notation
     * @return the set of keys
     */
    public Set<String> getKeys(boolean deep) {
        if (!deep) {
            return new LinkedHashSet<>(data.keySet());
        }

        Set<String> keys = new LinkedHashSet<>();
        collectKeys(data, "", keys);
        return keys;
    }

    @SuppressWarnings("unchecked")
    private void collectKeys(Map<String, Object> map, String prefix, Set<String> keys) {
        for (Map.Entry<String, Object> entry : map.entrySet()) {
            String fullKey = prefix.isEmpty() ? entry.getKey() : prefix + "." + entry.getKey();
            keys.add(fullKey);
            if (entry.getValue() instanceof Map) {
                collectKeys((Map<String, Object>) entry.getValue(), fullKey, keys);
            }
        }
    }

    /**
     * Gets a raw value from the configuration.
     *
     * @param key the key (supports dot notation for nested access)
     * @return the value, or null if not found
     */
    @SuppressWarnings("unchecked")
    public Object get(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }

        String[] parts = key.split("\\.");
        Object current = data;

        for (String part : parts) {
            if (current instanceof Map) {
                current = ((Map<String, Object>) current).get(part);
            } else {
                return null;
            }
        }

        return current;
    }

    /**
     * Gets a raw value directly from this section's data map without path navigation.
     * Useful when keys contain dots that should not be interpreted as path separators.
     *
     * @param key the key (treated as a literal key, no dot navigation)
     * @return the value, or null if not found
     */
    public Object getDirect(String key) {
        if (key == null || key.isEmpty()) {
            return null;
        }
        return data.get(key);
    }

    /**
     * Gets a value with a default fallback.
     *
     * @param key the key
     * @param defaultValue the default value if key is not found
     * @param <T> the type of the value
     * @return the value or default
     */
    @SuppressWarnings("unchecked")
    public <T> T get(String key, T defaultValue) {
        Object value = get(key);
        if (value == null) {
            return defaultValue;
        }

        if (defaultValue != null && !defaultValue.getClass().isInstance(value)) {
            // Try type conversion
            return (T) convertValue(value, defaultValue.getClass());
        }

        return (T) value;
    }

    /**
     * Gets a required value, throwing an exception if not found.
     *
     * @param key the key
     * @param type the expected type
     * @param <T> the type
     * @return the value
     * @throws ConfigurationException if the key is not found or type is wrong
     */
    public <T> T getRequired(String key, Class<T> type) {
        Object value = get(key);
        if (value == null) {
            throw ConfigurationException.missingKey(getFullPath(key));
        }
        return convertValue(value, type);
    }

    /**
     * Gets a String value.
     *
     * @param key the key
     * @return the string value, or null if not found
     */
    public String getString(String key) {
        Object value = get(key);
        return value != null ? String.valueOf(value) : null;
    }

    /**
     * Gets a String value with default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @return the string value or default
     */
    public String getString(String key, String defaultValue) {
        String value = getString(key);
        return value != null ? value : defaultValue;
    }

    /**
     * Gets an integer value.
     *
     * @param key the key
     * @return the integer value, or null if not found
     */
    public Integer getInt(String key) {
        Object value = get(key);
        if (value == null) return null;
        if (value instanceof Number) return ((Number) value).intValue();
        return Integer.parseInt(String.valueOf(value));
    }

    /**
     * Gets an integer value with default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @return the integer value or default
     */
    public int getInt(String key, int defaultValue) {
        Integer value = getInt(key);
        return value != null ? value : defaultValue;
    }

    /**
     * Gets a long value.
     *
     * @param key the key
     * @return the long value, or null if not found
     */
    public Long getLong(String key) {
        Object value = get(key);
        if (value == null) return null;
        if (value instanceof Number) return ((Number) value).longValue();
        return Long.parseLong(String.valueOf(value));
    }

    /**
     * Gets a long value with default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @return the long value or default
     */
    public long getLong(String key, long defaultValue) {
        Long value = getLong(key);
        return value != null ? value : defaultValue;
    }

    /**
     * Gets a double value.
     *
     * @param key the key
     * @return the double value, or null if not found
     */
    public Double getDouble(String key) {
        Object value = get(key);
        if (value == null) return null;
        if (value instanceof Number) return ((Number) value).doubleValue();
        return Double.parseDouble(String.valueOf(value));
    }

    /**
     * Gets a double value with default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @return the double value or default
     */
    public double getDouble(String key, double defaultValue) {
        Double value = getDouble(key);
        return value != null ? value : defaultValue;
    }

    /**
     * Gets a boolean value.
     *
     * @param key the key
     * @return the boolean value, or null if not found
     */
    public Boolean getBoolean(String key) {
        Object value = get(key);
        if (value == null) return null;
        if (value instanceof Boolean) return (Boolean) value;
        String str = String.valueOf(value).toLowerCase();
        return "true".equals(str) || "yes".equals(str) || "1".equals(str);
    }

    /**
     * Gets a boolean value with default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @return the boolean value or default
     */
    public boolean getBoolean(String key, boolean defaultValue) {
        Boolean value = getBoolean(key);
        return value != null ? value : defaultValue;
    }

    /**
     * Gets a list of strings.
     *
     * @param key the key
     * @return the list of strings, or empty list if not found
     */
    @SuppressWarnings("unchecked")
    public List<String> getStringList(String key) {
        Object value = get(key);
        if (value == null) return Collections.emptyList();
        if (value instanceof List) {
            return ((List<?>) value).stream()
                    .map(String::valueOf)
                    .collect(Collectors.toList());
        }
        return Collections.singletonList(String.valueOf(value));
    }

    /**
     * Gets a list of integers.
     *
     * @param key the key
     * @return the list of integers, or empty list if not found
     */
    @SuppressWarnings("unchecked")
    public List<Integer> getIntList(String key) {
        Object value = get(key);
        if (value == null) return Collections.emptyList();
        if (value instanceof List) {
            return ((List<?>) value).stream()
                    .map(v -> v instanceof Number ? ((Number) v).intValue() : Integer.parseInt(String.valueOf(v)))
                    .collect(Collectors.toList());
        }
        return Collections.singletonList(getInt(key));
    }

    /**
     * Gets a generic list.
     *
     * @param key the key
     * @param mapper function to convert list elements
     * @param <T> the element type
     * @return the list of converted elements, or empty list if not found
     */
    @SuppressWarnings("unchecked")
    public <T> List<T> getList(String key, Function<Object, T> mapper) {
        Object value = get(key);
        if (value == null) return Collections.emptyList();
        if (value instanceof List) {
            return ((List<?>) value).stream()
                    .map(mapper)
                    .collect(Collectors.toList());
        }
        return Collections.singletonList(mapper.apply(value));
    }

    /**
     * Gets a Duration from a string value (e.g., "30s", "5m", "1h").
     *
     * @param key the key
     * @return the Duration, or null if not found
     */
    public Duration getDuration(String key) {
        String value = getString(key);
        if (value == null || value.isEmpty()) return null;
        return parseDuration(value);
    }

    /**
     * Gets a Duration with default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @return the Duration or default
     */
    public Duration getDuration(String key, Duration defaultValue) {
        Duration value = getDuration(key);
        return value != null ? value : defaultValue;
    }

    /**
     * Parses a duration string (e.g., "30s", "5m", "1h", "1d").
     */
    private Duration parseDuration(String value) {
        value = value.trim().toLowerCase();
        if (value.endsWith("ms")) {
            return Duration.ofMillis(Long.parseLong(value.substring(0, value.length() - 2)));
        } else if (value.endsWith("s")) {
            return Duration.ofSeconds(Long.parseLong(value.substring(0, value.length() - 1)));
        } else if (value.endsWith("m")) {
            return Duration.ofMinutes(Long.parseLong(value.substring(0, value.length() - 1)));
        } else if (value.endsWith("h")) {
            return Duration.ofHours(Long.parseLong(value.substring(0, value.length() - 1)));
        } else if (value.endsWith("d")) {
            return Duration.ofDays(Long.parseLong(value.substring(0, value.length() - 1)));
        } else {
            // Assume milliseconds if no unit
            return Duration.ofMillis(Long.parseLong(value));
        }
    }

    /**
     * Gets a nested ConfigSection.
     *
     * @param key the key to the nested section
     * @return the nested ConfigSection, or null if not found or not a map
     */
    @SuppressWarnings("unchecked")
    public ConfigSection getSection(String key) {
        Object value = get(key);
        if (value instanceof Map) {
            return new ConfigSection((Map<String, Object>) value, getFullPath(key), root);
        }
        return null;
    }

    /**
     * Gets a nested ConfigSection, creating an empty one if not found.
     *
     * @param key the key to the nested section
     * @return the nested ConfigSection (never null)
     */
    public ConfigSection getSectionOrEmpty(String key) {
        ConfigSection section = getSection(key);
        return section != null ? section : new ConfigSection(new LinkedHashMap<>(), getFullPath(key), root);
    }

    /**
     * Sets a value in this configuration section.
     *
     * @param key the key (supports dot notation)
     * @param value the value to set
     */
    @SuppressWarnings("unchecked")
    public void set(String key, Object value) {
        if (key == null || key.isEmpty()) {
            return;
        }

        String[] parts = key.split("\\.");
        Map<String, Object> current = data;

        for (int i = 0; i < parts.length - 1; i++) {
            Object next = current.get(parts[i]);
            if (!(next instanceof Map)) {
                next = new LinkedHashMap<String, Object>();
                current.put(parts[i], next);
            }
            current = (Map<String, Object>) next;
        }

        if (value == null) {
            current.remove(parts[parts.length - 1]);
        } else {
            current.put(parts[parts.length - 1], value);
        }
    }

    /**
     * Gets the underlying data map.
     *
     * @return the raw data map
     */
    public Map<String, Object> toMap() {
        return new LinkedHashMap<>(data);
    }

    /**
     * Converts a value to the target type.
     */
    @SuppressWarnings("unchecked")
    private <T> T convertValue(Object value, Class<T> type) {
        if (value == null) {
            return null;
        }

        if (type.isInstance(value)) {
            return type.cast(value);
        }

        String strValue = String.valueOf(value);

        if (type == String.class) {
            return (T) strValue;
        } else if (type == Integer.class || type == int.class) {
            return (T) Integer.valueOf(strValue);
        } else if (type == Long.class || type == long.class) {
            return (T) Long.valueOf(strValue);
        } else if (type == Double.class || type == double.class) {
            return (T) Double.valueOf(strValue);
        } else if (type == Float.class || type == float.class) {
            return (T) Float.valueOf(strValue);
        } else if (type == Boolean.class || type == boolean.class) {
            return (T) Boolean.valueOf(strValue.equalsIgnoreCase("true") || 
                                        strValue.equals("1") || 
                                        strValue.equalsIgnoreCase("yes"));
        } else if (type == Duration.class) {
            return (T) parseDuration(strValue);
        } else if (type == Instant.class) {
            return (T) Instant.parse(strValue);
        }

        throw ConfigurationException.invalidValue(path, type, value);
    }

    /**
     * Creates a ConfigSection from a map.
     *
     * @param data the configuration data
     * @return a new ConfigSection
     */
    public static ConfigSection of(Map<String, Object> data) {
        return new ConfigSection(data);
    }

    /**
     * Creates an empty ConfigSection.
     *
     * @return an empty ConfigSection
     */
    public static ConfigSection empty() {
        return new ConfigSection(new LinkedHashMap<>());
    }

    @Override
    public String toString() {
        return "ConfigSection{path='" + path + "', keys=" + data.keySet() + "}";
    }
}
