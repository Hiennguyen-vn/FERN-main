package com.natsu.common.model.core.datastore;

/**
 * Exception thrown ONLY during translation stage when a required capability is
 * missing.
 */
public final class UnsupportedFeatureException extends RuntimeException {

    public UnsupportedFeatureException(String message) {
        super(message);
    }
}
