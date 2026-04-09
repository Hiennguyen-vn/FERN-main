package com.natsu.common.model.core.datastore;

/**
 * A compact AST representation of a filter condition.
 * Designed for minimum allocations and fast translation.
 */
public final class FilterNode {

    public final Op op;
    public final int fieldId;
    public final Object value;
    public final FilterNode left;
    public final FilterNode right;

    public FilterNode(Op op, int fieldId, Object value, FilterNode left, FilterNode right) {
        this.op = op;
        this.fieldId = fieldId;
        this.value = value;
        this.left = left;
        this.right = right;
    }

    public static FilterNode condition(Op op, int fieldId, Object value) {
        return new FilterNode(op, fieldId, value, null, null);
    }

    public static FilterNode and(FilterNode left, FilterNode right) {
        return new FilterNode(Op.AND, -1, null, left, right);
    }

    public static FilterNode or(FilterNode left, FilterNode right) {
        return new FilterNode(Op.OR, -1, null, left, right);
    }
}
