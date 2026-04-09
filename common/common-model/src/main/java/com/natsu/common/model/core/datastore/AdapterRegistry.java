package com.natsu.common.model.core.datastore;

/**
 * Array-based registry for DataAdapters ensuring O(1) lookup.
 */
public final class AdapterRegistry {

    private static final DataAdapter<?>[] ADAPTERS = new DataAdapter<?>[32];

    private AdapterRegistry() {
        // Prevent instantiation
    }

    /**
     * Registers an adapter by id.
     * 
     * @param id      The id (0 to 31).
     * @param adapter The adapter.
     */
    public static void register(int id, DataAdapter<?> adapter) {
        if (id < 0 || id >= ADAPTERS.length) {
            throw new IllegalArgumentException("Adapter ID must be between 0 and 31");
        }
        ADAPTERS[id] = adapter;
    }

    /**
     * Retrieves an adapter by id.
     * 
     * @param id The id (0 to 31).
     * @return The adapter.
     * @throws IllegalArgumentException if the id is out of range
     * @throws IllegalStateException    if no adapter is registered for the given id
     */
    public static DataAdapter<?> get(int id) {
        if (id < 0 || id >= ADAPTERS.length) {
            throw new IllegalArgumentException("Adapter ID must be between 0 and 31, got: " + id);
        }
        DataAdapter<?> adapter = ADAPTERS[id];
        if (adapter == null) {
            throw new IllegalStateException("No adapter registered for ID: " + id);
        }
        return adapter;
    }
}
