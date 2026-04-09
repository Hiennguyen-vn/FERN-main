package com.natsu.common.model.core.datastore;

/**
 * Represents a sort criteria.
 */
public final class Sort {

    public final int fieldId;
    public final boolean ascending;

    public Sort(int fieldId, boolean ascending) {
        this.fieldId = fieldId;
        this.ascending = ascending;
    }
}
