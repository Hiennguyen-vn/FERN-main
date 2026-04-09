package com.natsu.common.model.core.datastore;

/**
 * Translator that compiles a QueryIR into a SQL clause fragment.
 * Uses a ThreadLocal StringBuilder to avoid string concatenations and
 * allocations.
 */
public final class SqlTranslator implements Translator<String> {

    // ThreadLocal avoids synchronization and minimizes GC pressure
    private static final ThreadLocal<StringBuilder> BUILDER = ThreadLocal.withInitial(() -> new StringBuilder(256));
    private static final int MAX_REUSABLE_CAPACITY = 4096;

    @Override
    public String translate(QueryIR query, TranslationContext ctx) {
        StringBuilder sb = BUILDER.get();
        sb.setLength(0); // Reset length to reuse memory buffer

        if (query.rootFilter != null) {
            sb.append("WHERE ");
            buildFilter(query.rootFilter, ctx, sb);
        }

        if (query.sorts.length > 0) {
            sb.append(" ORDER BY ");
            for (int i = 0; i < query.sorts.length; i++) {
                if (i > 0)
                    sb.append(", ");
                sb.append(ctx.getFieldName(query.sorts[i].fieldId));
                sb.append(query.sorts[i].ascending ? " ASC" : " DESC");
            }
        }

        if (query.limit > 0) {
            sb.append(" LIMIT ").append(query.limit);
        }

        String result = sb.toString();

        // Prevent memory leaks: if the buffer grew too large, discard it
        // so the next call allocates a fresh, small StringBuilder.
        if (sb.capacity() > MAX_REUSABLE_CAPACITY) {
            BUILDER.remove();
        }

        return result;
    }

    /**
     * Builds the filter by passing the StringBuilder down recursively.
     * This achieves zero intermediate string allocations ("Avoid recursive string
     * concatenation").
     */
    private void buildFilter(FilterNode node, TranslationContext ctx, StringBuilder sb) {
        switch (node.op) {
            case AND:
                sb.append("(");
                buildFilter(node.left, ctx, sb);
                sb.append(" AND ");
                buildFilter(node.right, ctx, sb);
                sb.append(")");
                break;
            case OR:
                sb.append("(");
                buildFilter(node.left, ctx, sb);
                sb.append(" OR ");
                buildFilter(node.right, ctx, sb);
                sb.append(")");
                break;
            case EQ:
                sb.append(ctx.getFieldName(node.fieldId)).append("=?");
                break;
            case NEQ:
                sb.append(ctx.getFieldName(node.fieldId)).append("!=?");
                break;
            case GT:
                sb.append(ctx.getFieldName(node.fieldId)).append(">?");
                break;
            case LT:
                sb.append(ctx.getFieldName(node.fieldId)).append("<?");
                break;
            case GTE:
                sb.append(ctx.getFieldName(node.fieldId)).append(">=?");
                break;
            case LTE:
                sb.append(ctx.getFieldName(node.fieldId)).append("<=?");
                break;
            default:
                throw new UnsupportedFeatureException("Unsupported operator: " + node.op);
        }
    }
}
