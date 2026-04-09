package com.natsu.common.model.cache.annotation;

import java.lang.annotation.*;

/**
 * Enables caching for a class or defines default cache settings.
 *
 * <p>Usage:
 * <pre>
 * &#64;CacheConfig(cache = "users", ttl = "10m")
 * public class UserService {
 *
 *     &#64;Cacheable(key = "#userId")  // Uses "users" cache with 10m TTL
 *     public User findById(Long userId) { ... }
 * }
 * </pre>
 */
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface CacheConfig {

    /**
     * Default cache name(s) for methods in this class.
     *
     * @return the cache names
     */
    String[] cache() default {};

    /**
     * Default key generator to use.
     *
     * @return the key generator bean name
     */
    String keyGenerator() default "";

    /**
     * Default cache manager to use.
     *
     * @return the cache manager bean name
     */
    String cacheManager() default "";

    /**
     * Default TTL for cached values.
     *
     * @return the TTL string
     */
    String ttl() default "";
}
