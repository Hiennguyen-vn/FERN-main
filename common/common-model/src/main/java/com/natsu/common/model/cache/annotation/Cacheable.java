package com.natsu.common.model.cache.annotation;

import java.lang.annotation.*;

/**
 * Marks a method result as cacheable.
 * The first call will cache the result, subsequent calls return the cached value.
 *
 * <p>Usage:
 * <pre>
 * &#64;Cacheable(cache = "users", key = "#userId")
 * public User findById(Long userId) {
 *     return userRepository.findById(userId);
 * }
 *
 * &#64;Cacheable(cache = "products", key = "#category + ':' + #page", ttl = "5m")
 * public List&lt;Product&gt; findByCategory(String category, int page) {
 *     return productRepository.findByCategory(category, page);
 * }
 * </pre>
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Cacheable {

    /**
     * The cache name(s) to use.
     * If multiple caches are specified, the value is stored in all of them.
     *
     * @return the cache names
     */
    String[] cache() default {};

    /**
     * Alias for cache().
     *
     * @return the cache name
     */
    String value() default "";

    /**
     * SpEL expression for the cache key.
     * Can reference method parameters by name (e.g., #userId) or position (e.g., #p0).
     * If not specified, a key is generated from all method parameters.
     *
     * @return the key expression
     */
    String key() default "";

    /**
     * Time-to-live for the cached value.
     * Supports duration formats: "30s", "5m", "1h", "1d".
     *
     * @return the TTL string
     */
    String ttl() default "";

    /**
     * Condition for caching (SpEL expression).
     * If the condition evaluates to false, the method is executed but result is not cached.
     *
     * @return the condition expression
     */
    String condition() default "";

    /**
     * Condition for NOT caching (SpEL expression evaluated after method execution).
     * If true, the result is not cached.
     *
     * @return the unless expression
     */
    String unless() default "";

    /**
     * Whether to sync cache access (prevents cache stampede).
     *
     * @return true to synchronize
     */
    boolean sync() default false;
}
