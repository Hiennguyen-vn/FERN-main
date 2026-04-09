package com.natsu.common.model.cache;

import java.util.Arrays;
import java.util.Objects;
import java.util.StringJoiner;

/**
 * A parameterized cache key that combines a namespace with multiple parameters.
 * Provides a consistent way to build cache keys from multiple values.
 *
 * <p>Usage:
 * <pre>
 * // Simple key
 * CacheKey key = CacheKey.of("user", userId);
 * // Result: "user:123"
 *
 * // Multi-parameter key
 * CacheKey key = CacheKey.of("user", userId, "profile", "avatar");
 * // Result: "user:123:profile:avatar"
 *
 * // With builder
 * CacheKey key = CacheKey.builder("orders")
 *     .param("user", userId)
 *     .param("status", "pending")
 *     .param("page", pageNum)
 *     .build();
 * // Result: "orders:user=123:status=pending:page=1"
 * </pre>
 */
public final class CacheKey {

    private static final String DEFAULT_SEPARATOR = ":";

    private final String namespace;
    private final Object[] params;
    private final String separator;
    private volatile String cachedKey;

    private CacheKey(String namespace, Object[] params, String separator) {
        this.namespace = namespace;
        this.params = params;
        this.separator = separator;
    }

    /**
     * Creates a cache key with a namespace only.
     *
     * @param namespace the key namespace
     * @return the cache key
     */
    public static CacheKey of(String namespace) {
        return new CacheKey(namespace, new Object[0], DEFAULT_SEPARATOR);
    }

    /**
     * Creates a cache key with namespace and parameters.
     *
     * @param namespace the key namespace
     * @param params the key parameters
     * @return the cache key
     */
    public static CacheKey of(String namespace, Object... params) {
        return new CacheKey(namespace, params, DEFAULT_SEPARATOR);
    }

    /**
     * Creates a cache key builder.
     *
     * @param namespace the key namespace
     * @return a new builder
     */
    public static Builder builder(String namespace) {
        return new Builder(namespace);
    }

    /**
     * Gets the namespace.
     *
     * @return the namespace
     */
    public String getNamespace() {
        return namespace;
    }

    /**
     * Gets the parameters.
     *
     * @return the parameters (defensive copy)
     */
    public Object[] getParams() {
        return Arrays.copyOf(params, params.length);
    }

    /**
     * Converts this key to a string representation.
     *
     * @return the string key
     */
    public String toKeyString() {
        if (cachedKey != null) {
            return cachedKey;
        }

        if (params.length == 0) {
            cachedKey = namespace;
            return cachedKey;
        }

        StringJoiner joiner = new StringJoiner(separator);
        joiner.add(namespace);
        for (Object param : params) {
            joiner.add(String.valueOf(param));
        }
        cachedKey = joiner.toString();
        return cachedKey;
    }

    /**
     * Creates a new key by appending additional parameters.
     *
     * @param additionalParams the parameters to append
     * @return a new cache key
     */
    public CacheKey append(Object... additionalParams) {
        Object[] newParams = new Object[params.length + additionalParams.length];
        System.arraycopy(params, 0, newParams, 0, params.length);
        System.arraycopy(additionalParams, 0, newParams, params.length, additionalParams.length);
        return new CacheKey(namespace, newParams, separator);
    }

    @Override
    public String toString() {
        return toKeyString();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        CacheKey cacheKey = (CacheKey) o;
        return Objects.equals(namespace, cacheKey.namespace) &&
               Arrays.equals(params, cacheKey.params);
    }

    @Override
    public int hashCode() {
        int result = Objects.hash(namespace);
        result = 31 * result + Arrays.hashCode(params);
        return result;
    }

    /**
     * Builder for creating complex cache keys with named parameters.
     */
    public static class Builder {
        private final String namespace;
        private final java.util.List<String> parts = new java.util.ArrayList<>();
        private String separator = DEFAULT_SEPARATOR;

        private Builder(String namespace) {
            this.namespace = namespace;
        }

        /**
         * Adds a simple parameter value.
         *
         * @param value the parameter value
         * @return this builder
         */
        public Builder param(Object value) {
            parts.add(String.valueOf(value));
            return this;
        }

        /**
         * Adds a named parameter (name=value format).
         *
         * @param name the parameter name
         * @param value the parameter value
         * @return this builder
         */
        public Builder param(String name, Object value) {
            parts.add(name + "=" + value);
            return this;
        }

        /**
         * Sets a custom separator.
         *
         * @param separator the separator string
         * @return this builder
         */
        public Builder separator(String separator) {
            this.separator = separator;
            return this;
        }

        /**
         * Builds the cache key.
         *
         * @return the cache key
         */
        public CacheKey build() {
            return new CacheKey(namespace, parts.toArray(), separator);
        }
    }
}
