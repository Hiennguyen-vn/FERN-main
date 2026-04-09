package com.natsu.common.model.cache.annotation;

import java.lang.annotation.*;

/**
 * Evicts entries from the cache.
 *
 * <p>Usage:
 * <pre>
 * &#64;CacheEvict(cache = "users", key = "#userId")
 * public void deleteUser(Long userId) {
 *     userRepository.deleteById(userId);
 * }
 *
 * &#64;CacheEvict(cache = "users", allEntries = true)
 * public void clearUserCache() {
 *     // Clears entire cache
 * }
 * </pre>
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CacheEvict {

    /**
     * The cache name(s) to evict from.
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
     * SpEL expression for the cache key to evict.
     *
     * @return the key expression
     */
    String key() default "";

    /**
     * Whether to evict all entries from the cache.
     *
     * @return true to clear all entries
     */
    boolean allEntries() default false;

    /**
     * Whether to evict before or after method execution.
     * If true, eviction happens before the method runs.
     *
     * @return true for before invocation
     */
    boolean beforeInvocation() default false;

    /**
     * Condition for eviction (SpEL expression).
     *
     * @return the condition expression
     */
    String condition() default "";
}
