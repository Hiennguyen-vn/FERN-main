package com.fern.common.test;

import com.fern.common.spring.auth.RequestUserContext;
import com.fern.common.spring.auth.RequestUserContextHolder;
import java.util.Set;

/**
 * Helper for building {@link RequestUserContext} instances and pushing them into the holder
 * during integration tests. Always paired with try-with-resources or explicit clear.
 */
public final class TestUserContext {

  private TestUserContext() {
  }

  public static AutoCloseable userScope(long userId, String username, Set<Long> outletIds, Set<String> roles) {
    RequestUserContextHolder.set(new RequestUserContext(
        userId, username, "test-session-" + userId,
        roles == null ? Set.of() : roles,
        Set.of(),
        outletIds == null ? Set.of() : outletIds,
        true, false, null, null, null));
    return RequestUserContextHolder::clear;
  }

  public static AutoCloseable internalServiceScope(String callerService) {
    RequestUserContextHolder.set(new RequestUserContext(
        null, "internal-" + callerService, null,
        Set.of("internal"), Set.of(), Set.of(),
        true, true, callerService, null, null));
    return RequestUserContextHolder::clear;
  }

  public static AutoCloseable deviceScope(long deviceId, long outletId) {
    RequestUserContextHolder.set(new RequestUserContext(
        null, "device-" + deviceId, null,
        Set.of("pos.device"), Set.of(), Set.of(outletId),
        true, false, null, deviceId, outletId));
    return RequestUserContextHolder::clear;
  }
}
