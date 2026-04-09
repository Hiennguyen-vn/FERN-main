package com.natsu.common.model.core.datastore;

/**
 * Base adapter capable of executing a native query format.
 *
 * @param <TNative> the native query format.
 */
public interface DataAdapter<TNative> {

    /**
     * The unique, integer-based ID for lookup in AdapterRegistry.
     * 
     * @return ID between 0 and 31.
     */
    int id();

    /**
     * Bitmask indicating which features this adapter supports.
     * Checked against CapabilityFlags.
     * 
     * @return the bitmask.
     */
    int capabilityMask();

    /**
     * Executes the translated native query.
     * 
     * @param nativeQuery the native query object.
     * @return a Result.
     */
    Result execute(TNative nativeQuery);
}
