package com.natsu.common.model.core.datastore;

/**
 * Defines capability bitmask flags to allow O(1) checking of feature support.
 * Avoids checking for feature support via reflection or scattered logic.
 */
public final class CapabilityFlags {

    public static final int FILTER = 1;
    public static final int SORT = 1 << 1;
    public static final int LIMIT = 1 << 2;
    public static final int JOIN = 1 << 3;
    public static final int TX = 1 << 4;

    private CapabilityFlags() {
        // Prevent instantiation
    }
}
