package com.natsu.common.model.core.datastore;

/**
 * Represents the results of a datastore query.
 * Can be an iterator or a list depending on capability and implementation.
 */
public interface Result {

    /**
     * @return true if there are more records.
     */
    boolean hasNext();

    /**
     * @return The next record, or null if exhausted.
     */
    Object next();
}
