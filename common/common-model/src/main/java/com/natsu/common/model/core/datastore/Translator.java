package com.natsu.common.model.core.datastore;

/**
 * Stateless singleton interface acting as a compiler backend.
 * Converts a QueryIR directly into a native query object (e.g. String, Bson).
 *
 * @param <TNative> The native statement/query format.
 */
public interface Translator<TNative> {

    /**
     * Translates the IR to a native query.
     * MUST NOT use streams, sync blocks, or excessive heap allocation.
     * 
     * @param query The QueryIR object.
     * @param ctx   The translation context containing field mappings.
     * @return A native query object.
     * @throws UnsupportedFeatureException if the query requires an unsupported
     *                                     capability.
     */
    TNative translate(QueryIR query, TranslationContext ctx);
}
