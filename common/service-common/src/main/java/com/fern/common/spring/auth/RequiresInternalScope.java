package com.fern.common.spring.auth;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * Declares required internal-service scope for a controller method.
 * Enforced by RequestAuthenticationFilter when internal JWT is present.
 *
 * Example: @RequiresInternalScope("inventory:stock-read")
 */
@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface RequiresInternalScope {
  String value();
}
