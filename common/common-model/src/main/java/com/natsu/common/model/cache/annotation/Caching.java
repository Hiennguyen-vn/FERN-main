package com.natsu.common.model.cache.annotation;

import java.lang.annotation.*;

/**
 * Groups multiple cache operations on a single method.
 *
 * <p>Usage:
 * <pre>
 * &#64;Caching(
 *     cacheable = &#64;Cacheable(cache = "users", key = "#userId"),
 *     evict = {
 *         &#64;CacheEvict(cache = "userList"),
 *         &#64;CacheEvict(cache = "userStats", key = "#userId")
 *     }
 * )
 * public User updateUser(Long userId, UserUpdate update) {
 *     return userRepository.update(userId, update);
 * }
 * </pre>
 */
@Target({ElementType.METHOD})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Caching {

    /**
     * Cacheable operations to apply.
     *
     * @return the cacheable annotations
     */
    Cacheable[] cacheable() default {};

    /**
     * CachePut operations to apply.
     *
     * @return the cache put annotations
     */
    CachePut[] put() default {};

    /**
     * CacheEvict operations to apply.
     *
     * @return the cache evict annotations
     */
    CacheEvict[] evict() default {};
}
