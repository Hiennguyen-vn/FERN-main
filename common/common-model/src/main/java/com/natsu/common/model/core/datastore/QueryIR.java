package com.natsu.common.model.core.datastore;

/**
 * Intermediate Representation (IR) for Queries.
 * This structure is immutable, pre-validated, and uses primitive elements.
 * 
 * It acts like an instruction tree for Translator backends.
 */
public final class QueryIR {

    public final FilterNode rootFilter;
    public final Projection[] projections;
    public final Sort[] sorts;
    public final int limit;

    // Helper constant for empty arrays to prevent allocations
    public static final Projection[] NO_PROJECTIONS = new Projection[0];
    public static final Sort[] NO_SORTS = new Sort[0];

    public QueryIR(FilterNode rootFilter, Projection[] projections, Sort[] sorts, int limit) {
        this.rootFilter = rootFilter;
        this.projections = projections != null ? projections : NO_PROJECTIONS;
        this.sorts = sorts != null ? sorts : NO_SORTS;
        this.limit = limit;
    }
}
