package com.dorabets.common.spring.auth;

import java.util.Set;
import java.util.function.Supplier;

/**
 * Establishes the same internal-service context that HTTP requests receive from
 * RequestAuthenticationFilter, for Kafka listeners and scheduled jobs.
 */
public final class InternalExecutionContext {

  private InternalExecutionContext() {
  }

  public static void run(String serviceName, Runnable work) {
    call(serviceName, () -> {
      work.run();
      return null;
    });
  }

  public static <T> T call(String serviceName, Supplier<T> work) {
    RequestUserContext previousContext = RequestUserContextHolder.get();
    OutletScopeContext.ScopeSnapshot previousScope = OutletScopeContext.snapshot();
    try {
      RequestUserContextHolder.set(new RequestUserContext(
          null,
          null,
          null,
          Set.of(),
          Set.of(),
          Set.of(),
          false,
          true,
          serviceName,
          null,
          null
      ));
      OutletScopeContext.set(OutletScopeContext.ALL);
      return work.get();
    } finally {
      RequestUserContextHolder.set(previousContext);
      OutletScopeContext.restore(previousScope);
    }
  }
}
