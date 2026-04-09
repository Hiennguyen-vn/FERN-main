package com.natsu.common.model.database.nosql;

import java.time.Instant;
import java.util.*;

/**
 * Represents a document in a NoSQL database.
 */
public class Document {

    private final Map<String, Object> data;

    public Document() {
        this.data = new LinkedHashMap<>();
    }

    public Document(Map<String, Object> data) {
        this.data = new LinkedHashMap<>(data);
    }

    /**
     * Creates an empty document.
     *
     * @return an empty document
     */
    public static Document empty() {
        return new Document();
    }

    /**
     * Creates a document from a map.
     *
     * @param data the data
     * @return the document
     */
    public static Document of(Map<String, Object> data) {
        return new Document(data);
    }

    /**
     * Creates a document with a single field.
     *
     * @param key the key
     * @param value the value
     * @return the document
     */
    public static Document of(String key, Object value) {
        Document doc = new Document();
        doc.put(key, value);
        return doc;
    }

    /**
     * Gets the document ID.
     *
     * @return the ID, or null
     */
    public String getId() {
        Object id = data.get("_id");
        if (id == null) {
            id = data.get("id");
        }
        return id != null ? id.toString() : null;
    }

    /**
     * Sets the document ID.
     *
     * @param id the ID
     * @return this document
     */
    public Document setId(String id) {
        data.put("_id", id);
        return this;
    }

    /**
     * Puts a value.
     *
     * @param key the key
     * @param value the value
     * @return this document
     */
    public Document put(String key, Object value) {
        data.put(key, value);
        return this;
    }

    /**
     * Puts all values from a map.
     *
     * @param values the values
     * @return this document
     */
    public Document putAll(Map<String, Object> values) {
        data.putAll(values);
        return this;
    }

    /**
     * Gets a value.
     *
     * @param key the key
     * @return the value, or null
     */
    public Object get(String key) {
        return data.get(key);
    }

    /**
     * Gets a typed value.
     *
     * @param key the key
     * @param type the expected type
     * @param <T> the type
     * @return the value
     */
    @SuppressWarnings("unchecked")
    public <T> T get(String key, Class<T> type) {
        Object value = data.get(key);
        if (value == null) {
            return null;
        }
        if (type.isInstance(value)) {
            return (T) value;
        }
        // Handle common conversions
        if (type == String.class) {
            return (T) value.toString();
        }
        if (type == Integer.class && value instanceof Number) {
            return (T) Integer.valueOf(((Number) value).intValue());
        }
        if (type == Long.class && value instanceof Number) {
            return (T) Long.valueOf(((Number) value).longValue());
        }
        if (type == Double.class && value instanceof Number) {
            return (T) Double.valueOf(((Number) value).doubleValue());
        }
        if (type == Boolean.class) {
            if (value instanceof Number) {
                return (T) Boolean.valueOf(((Number) value).intValue() != 0);
            }
            return (T) Boolean.valueOf(value.toString());
        }
        return (T) value;
    }

    /**
     * Gets a value with a default.
     *
     * @param key the key
     * @param defaultValue the default value
     * @param <T> the type
     * @return the value or default
     */
    @SuppressWarnings("unchecked")
    public <T> T getOrDefault(String key, T defaultValue) {
        Object value = data.get(key);
        if (value == null) {
            return defaultValue;
        }
        return (T) value;
    }

    public String getString(String key) {
        return get(key, String.class);
    }

    public Integer getInteger(String key) {
        return get(key, Integer.class);
    }

    public Long getLong(String key) {
        return get(key, Long.class);
    }

    public Double getDouble(String key) {
        return get(key, Double.class);
    }

    public Boolean getBoolean(String key) {
        return get(key, Boolean.class);
    }

    @SuppressWarnings("unchecked")
    public List<Object> getList(String key) {
        Object value = data.get(key);
        if (value instanceof List) {
            return (List<Object>) value;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    public <T> List<T> getList(String key, Class<T> elementType) {
        List<Object> list = getList(key);
        if (list == null) return null;
        List<T> result = new ArrayList<>();
        for (Object item : list) {
            if (elementType.isInstance(item)) {
                result.add((T) item);
            }
        }
        return result;
    }

    @SuppressWarnings("unchecked")
    public Document getDocument(String key) {
        Object value = data.get(key);
        if (value instanceof Document) {
            return (Document) value;
        }
        if (value instanceof Map) {
            return Document.of((Map<String, Object>) value);
        }
        return null;
    }

    public Instant getInstant(String key) {
        Object value = data.get(key);
        if (value instanceof Instant) {
            return (Instant) value;
        }
        if (value instanceof Date) {
            return ((Date) value).toInstant();
        }
        if (value instanceof Long) {
            return Instant.ofEpochMilli((Long) value);
        }
        return null;
    }

    /**
     * Checks if a key exists.
     *
     * @param key the key
     * @return true if exists
     */
    public boolean containsKey(String key) {
        return data.containsKey(key);
    }

    /**
     * Removes a key.
     *
     * @param key the key
     * @return the removed value
     */
    public Object remove(String key) {
        return data.remove(key);
    }

    /**
     * Gets all keys.
     *
     * @return set of keys
     */
    public Set<String> keys() {
        return data.keySet();
    }

    /**
     * Gets the number of fields.
     *
     * @return the field count
     */
    public int size() {
        return data.size();
    }

    /**
     * Checks if the document is empty.
     *
     * @return true if empty
     */
    public boolean isEmpty() {
        return data.isEmpty();
    }

    /**
     * Converts to a map.
     *
     * @return the map
     */
    public Map<String, Object> toMap() {
        return new LinkedHashMap<>(data);
    }

    @Override
    public String toString() {
        return data.toString();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Document document = (Document) o;
        return Objects.equals(data, document.data);
    }

    @Override
    public int hashCode() {
        return Objects.hash(data);
    }
}
