package com.natsu.common.utils.services.id;

/**
 * Interface definition for ID generators.
 */
public interface IdGenerator {

    /**
     * Generates a unique numeric ID.
     *
     * @return a 64-bit long integer representing the auto-generated unique
     *         identifier
     */
    long generateId();
}
