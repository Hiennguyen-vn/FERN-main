package com.natsu.common.model.cache.annotation;

import java.lang.annotation.*;

/**
 * Updates the cache with the method result, without checking for existing value.
 * Always executes the method and caches the result.
 *
 * <p>Usage:
 * <pre>
 * &#64;CachePut(cache = "users", key = "#user.id")
 * public User updateUser(User user) {
 *     return userRepository.save(user);
 * }
 * </pre>
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CachePut {

    /**
     * The cache name(s) to update.
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
     * Can reference method parameters and the return value (#result).
     *
     * @return the key expression
     */
    String key() default "";

    /**
     * Time-to-live for the cached value.
     *
     * @return the TTL string
     */
    String ttl() default "";

    /**
     * Condition for caching (SpEL expression).
     *
     * @return the condition expression
     */
    String condition() default "";

    /**
     * Condition for NOT caching (SpEL expression).
     *
     * @return the unless expression
     */
    String unless() default "";
}
