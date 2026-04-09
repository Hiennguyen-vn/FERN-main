package com.dorabets.common.spring.auth;

public final class RequestUserContextHolder {

  private static final ThreadLocal<RequestUserContext> HOLDER =
      ThreadLocal.withInitial(RequestUserContext::anonymous);

  private RequestUserContextHolder() {
  }

  public static RequestUserContext get() {
    return HOLDER.get();
  }

  public static void set(RequestUserContext context) {
    HOLDER.set(context == null ? RequestUserContext.anonymous() : context);
  }

  public static void clear() {
    HOLDER.remove();
  }
}
