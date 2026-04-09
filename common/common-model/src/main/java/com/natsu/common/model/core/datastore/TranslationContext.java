package com.natsu.common.model.core.datastore;

/**
 * Context passed during query translation.
 * Useful for resolving field names, passing tenant state, etc.
 */
public interface TranslationContext {

    /**
     * Translates a numeric fieldId to its actual native string or column name.
     * 
     * @param fieldId The integer representing the field.
     * @return The native column/field name.
     */
    String getFieldName(int fieldId);
}
