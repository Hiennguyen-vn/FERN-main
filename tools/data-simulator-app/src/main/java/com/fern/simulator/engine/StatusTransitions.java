package com.fern.simulator.engine;

import java.util.Map;
import java.util.Set;

/**
 * Defines allowed status transitions for every entity type the simulator manages.
 * The engine must only produce transitions listed here.
 */
public final class StatusTransitions {

    private StatusTransitions() {}

    /** Outlet status transitions (location_status_enum). */
    public static final Map<String, Set<String>> OUTLET = Map.of(
            "draft", Set.of("active"),
            "active", Set.of("inactive", "closed"),
            "inactive", Set.of("active")
    );

    /** User status transitions (user_status_enum). */
    public static final Map<String, Set<String>> USER = Map.of(
            "active", Set.of("inactive", "suspended"),
            "suspended", Set.of("inactive"),
            "inactive", Set.of("active")
    );

    /** Employee contract status transitions (contract_status_enum). */
    public static final Map<String, Set<String>> CONTRACT = Map.of(
            "draft", Set.of("active"),
            "active", Set.of("terminated", "expired")
    );

    /** Purchase order status transitions (po_status_enum). */
    public static final Map<String, Set<String>> PURCHASE_ORDER = Map.of(
            "draft", Set.of("submitted"),
            "submitted", Set.of("approved"),
            "approved", Set.of("ordered"),
            "ordered", Set.of("partially_received", "completed"),
            "partially_received", Set.of("completed"),
            "completed", Set.of("closed")
    );

    /** Purchase order item status transitions (po_item_status_enum). */
    public static final Map<String, Set<String>> PO_ITEM = Map.of(
            "open", Set.of("partially_received", "completed"),
            "partially_received", Set.of("completed")
    );

    /** Goods receipt status transitions (receipt_status_enum). */
    public static final Map<String, Set<String>> GOODS_RECEIPT = Map.of(
            "draft", Set.of("received"),
            "received", Set.of("posted")
    );

    /** Supplier invoice status transitions (supplier_invoice_status_enum). */
    public static final Map<String, Set<String>> SUPPLIER_INVOICE = Map.of(
            "draft", Set.of("received"),
            "received", Set.of("matched"),
            "matched", Set.of("approved"),
            "approved", Set.of("posted")
    );

    /** Supplier payment status transitions (supplier_payment_status_enum). */
    public static final Map<String, Set<String>> SUPPLIER_PAYMENT = Map.of(
            "pending", Set.of("posted")
    );

    /** Payroll status transitions (payroll_status_enum). */
    public static final Map<String, Set<String>> PAYROLL = Map.of(
            "draft", Set.of("approved"),
            "approved", Set.of("paid")
    );

    /** POS session status transitions (pos_session_status_enum). */
    public static final Map<String, Set<String>> POS_SESSION = Map.of(
            "open", Set.of("closed")
    );

    /** Sale record status transitions (sale_order_status_enum). */
    public static final Map<String, Set<String>> SALE_RECORD = Map.of(
            "open", Set.of("completed", "cancelled"),
            "completed", Set.of("refunded", "partially_refunded", "voided")
    );

    /** Payment transaction status transitions (payment_txn_status_enum). */
    public static final Map<String, Set<String>> PAYMENT = Map.of(
            "pending", Set.of("success"),
            "success", Set.of("refunded", "cancelled")
    );

    /** Promotion status transitions (promo_status_enum). */
    public static final Map<String, Set<String>> PROMOTION = Map.of(
            "draft", Set.of("active"),
            "active", Set.of("expired")
    );

    /**
     * Validates that a transition from one status to another is allowed.
     * @throws IllegalStateException if the transition is not allowed
     */
    public static void validate(Map<String, Set<String>> transitions, String entityType,
                                  String from, String to) {
        Set<String> allowed = transitions.get(from);
        if (allowed == null || !allowed.contains(to)) {
            throw new IllegalStateException(
                    entityType + ": illegal transition " + from + " → " + to +
                    ". Allowed from " + from + ": " + (allowed != null ? allowed : "none"));
        }
    }
}
