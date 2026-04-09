package com.natsu.common.model.core.datastore;

/**
 * Ultra-thin dispatcher that hooks an Adapter ID to its Translator and
 * DataAdapter.
 * Requires zero instanceof checks and mapping resolutions on the hot path.
 */
public final class UnifiedDataStore {

    /**
     * Array of translators. The index maps directly to the Adapter ID.
     */
    private final Translator<?>[] translators = new Translator<?>[32];

    public UnifiedDataStore() {
        // Init empty
    }

    /**
     * Registers a translator for a given adapter ID.
     * 
     * @param id         adapter ID (0-31)
     * @param translator Translator implementation
     */
    public void registerTranslator(int id, Translator<?> translator) {
        this.translators[id] = translator;
    }

    /**
     * Main dispatch method. Translates then executes.
     * 
     * @param adapterId The target adapter ID.
     * @param query     The IR Query.
     * @param ctx       The translation context for field mapping.
     * @return The results of the DB query.
     */
    @SuppressWarnings("unchecked")
    public Result find(int adapterId, QueryIR query, TranslationContext ctx) {

        // 1. O(1) Fetch DataAdapter
        DataAdapter<Object> adapter = (DataAdapter<Object>) AdapterRegistry.get(adapterId);

        // 2. O(1) Fetch Translator
        Translator<Object> translator = (Translator<Object>) translators[adapterId];

        // 3. Compile IR directly to Native Query
        Object nativeQuery = translator.translate(query, ctx);

        // 4. Exec Native Query using Adapter
        return adapter.execute(nativeQuery);
    }
}
