package com.dorabets.common.spring.auth;

/**
 * Per-request outlet scope used to drive Postgres RLS via the fern.outlet_id /
 * fern.outlet_ids GUCs.
 * <p>
 * Set this once per inbound request (before any DB call). Repository helpers read
 * it and emit {@code SET LOCAL fern.outlet_id = '<id>'} plus
 * {@code SET LOCAL fern.outlet_ids = '<csv>'} at the start of each transaction.
 * The sentinel {@code -1L} maps to {@code 'all'} — only callers with a superadmin
 * / internal-service scope should be granted that value.
 */
public final class OutletScopeContext {

    /** Sentinel for cross-outlet (admin / internal) scope. */
    public static final long ALL = -1L;

    private static final ThreadLocal<Scope> HOLDER = new ThreadLocal<>();

    private OutletScopeContext() {}

    public static void set(Long outletId) {
        if (outletId == null) {
            HOLDER.remove();
        } else {
            HOLDER.set(Scope.single(outletId));
        }
    }

    public static Long get() {
        Scope scope = HOLDER.get();
        return scope == null ? null : scope.primaryOutletId();
    }

    public static ScopeSnapshot snapshot() {
        Scope scope = HOLDER.get();
        if (scope == null) {
            return ScopeSnapshot.unset();
        }
        return new ScopeSnapshot(scope.primaryOutletId(), scope.allowedOutletIds());
    }

    public static void restore(ScopeSnapshot snapshot) {
        if (snapshot == null || snapshot.isUnset()) {
            HOLDER.remove();
            return;
        }
        HOLDER.set(new Scope(snapshot.primaryOutletId(), snapshot.allowedOutletIds()));
    }

    public static void setAllowedOutletIds(java.util.Set<Long> outletIds) {
        if (outletIds == null || outletIds.isEmpty()) {
            HOLDER.remove();
        } else {
            HOLDER.set(Scope.allowed(outletIds));
        }
    }

    public static void clear() {
        HOLDER.remove();
    }

    /** Format value for Postgres GUC. {@code null} → 'unset' (fail-closed). */
    public static String gucValue() {
        Scope scope = HOLDER.get();
        Long v = scope == null ? null : scope.primaryOutletId();
        if (v == null) return "unset";
        if (v == ALL) return "all";
        return Long.toString(v);
    }

    public static String gucOutletIdsValue() {
        Scope scope = HOLDER.get();
        if (scope == null || scope.allowedOutletIds().isEmpty()) return "";
        Long primaryOutletId = scope.primaryOutletId();
        if (primaryOutletId != null && primaryOutletId == ALL) return "all";
        return scope.allowedOutletIds().stream()
            .sorted()
            .map(String::valueOf)
            .reduce((a, b) -> a + "," + b)
            .orElse("");
    }

    private record Scope(Long primaryOutletId, java.util.Set<Long> allowedOutletIds) {
        private Scope {
            allowedOutletIds = allowedOutletIds == null ? java.util.Set.of() : java.util.Set.copyOf(allowedOutletIds);
        }

        static Scope single(long outletId) {
            if (outletId == ALL) {
                return new Scope(ALL, java.util.Set.of());
            }
            return new Scope(outletId, java.util.Set.of(outletId));
        }

        static Scope allowed(java.util.Set<Long> outletIds) {
            java.util.LinkedHashSet<Long> cleaned = new java.util.LinkedHashSet<>();
            for (Long outletId : outletIds) {
                if (outletId != null && outletId > 0) {
                    cleaned.add(outletId);
                }
            }
            if (cleaned.isEmpty()) {
                return new Scope(null, java.util.Set.of());
            }
            Long primary = cleaned.size() == 1 ? cleaned.iterator().next() : null;
            return new Scope(primary, cleaned);
        }
    }

    public record ScopeSnapshot(Long primaryOutletId, java.util.Set<Long> allowedOutletIds) {
        public ScopeSnapshot {
            allowedOutletIds = allowedOutletIds == null ? java.util.Set.of() : java.util.Set.copyOf(allowedOutletIds);
        }

        static ScopeSnapshot unset() {
            return new ScopeSnapshot(null, java.util.Set.of());
        }

        boolean isUnset() {
            return primaryOutletId == null && allowedOutletIds.isEmpty();
        }
    }
}
