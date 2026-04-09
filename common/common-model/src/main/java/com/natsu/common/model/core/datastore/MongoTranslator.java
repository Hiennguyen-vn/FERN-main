package com.natsu.common.model.core.datastore;

/**
 * Translator that compiles a QueryIR into a BsonDocument representation.
 * Uses pre-sized object containers to avoid recursive collection allocation.
 */
public final class MongoTranslator implements Translator<BsonDocument> {

    @Override
    public BsonDocument translate(QueryIR query, TranslationContext ctx) {
        // Use a pre-sized container, assuming simple queries fit in 16 slots.
        BsonDocument root = new BsonDocument(16);

        if (query.rootFilter != null) {
            buildFilter(query.rootFilter, ctx, root);
        }

        // Sorting, limit, and projection would typically be passed to separate methods
        // in MongoDB rather than directly inside the filter document.
        // We handle only the root filter for the query document translation.
        return root;
    }

    private void buildFilter(FilterNode node, TranslationContext ctx, BsonDocument doc) {
        switch (node.op) {
            case AND:
            case OR:
                // MongoDB requires an array for $and/$or.
                // We create a nested structure by passing child nodes in.
                BsonDocument nestedLeft = new BsonDocument(8);
                BsonDocument nestedRight = new BsonDocument(8);
                buildFilter(node.left, ctx, nestedLeft);
                buildFilter(node.right, ctx, nestedRight);

                // Emulating BSON array using values
                doc.append(node.op == Op.AND ? "$and" : "$or", new Object[] { nestedLeft, nestedRight });
                break;

            case EQ:
                doc.append(ctx.getFieldName(node.fieldId), node.value);
                break;

            case NEQ:
                doc.append(ctx.getFieldName(node.fieldId), buildWrapper("$ne", node.value));
                break;

            case GT:
                doc.append(ctx.getFieldName(node.fieldId), buildWrapper("$gt", node.value));
                break;

            case LT:
                doc.append(ctx.getFieldName(node.fieldId), buildWrapper("$lt", node.value));
                break;

            case GTE:
                doc.append(ctx.getFieldName(node.fieldId), buildWrapper("$gte", node.value));
                break;

            case LTE:
                doc.append(ctx.getFieldName(node.fieldId), buildWrapper("$lte", node.value));
                break;

            default:
                throw new UnsupportedFeatureException("Unsupported operator in Mongo: " + node.op);
        }
    }

    private BsonDocument buildWrapper(String op, Object value) {
        BsonDocument wrapper = new BsonDocument(1);
        wrapper.append(op, value);
        return wrapper;
    }
}
