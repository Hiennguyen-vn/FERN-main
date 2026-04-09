package com.natsu.common.model.core.datastore;

/**
 * A lightweight, zero-dependency BSON-like Document representation.
 * Uses pre-sized arrays instead of standard Collections to minimize GC
 * overhead.
 */
public final class BsonDocument {

    private final String[] keys;
    private final Object[] values;
    private int size = 0;

    /**
     * Initializes the document with a pre-sized capacity.
     * 
     * @param capacity Maximum number of elements.
     */
    public BsonDocument(int capacity) {
        this.keys = new String[capacity];
        this.values = new Object[capacity];
    }

    /**
     * Appends a key-value pair to the document.
     * 
     * @param key   the property name.
     * @param value the property value.
     */
    public void append(String key, Object value) {
        if (size < keys.length) {
            this.keys[size] = key;
            this.values[size] = value;
            this.size++;
        } else {
            throw new IllegalStateException("BsonDocument capacity exceeded.");
        }
    }

    public int size() {
        return size;
    }

    public String getKey(int index) {
        return keys[index];
    }

    public Object getValue(int index) {
        return values[index];
    }
}
