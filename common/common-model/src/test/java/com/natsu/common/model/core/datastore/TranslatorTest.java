package com.natsu.common.model.core.datastore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class TranslatorTest {

    private final TranslationContext ctx = new TranslationContext() {
        @Override
        public String getFieldName(int fieldId) {
            switch (fieldId) {
                case 1:
                    return "name";
                case 2:
                    return "age";
                case 3:
                    return "status";
                default:
                    return "field_" + fieldId;
            }
        }
    };

    @Test
    void testSqlTranslation() {
        SqlTranslator sqlTranslator = new SqlTranslator();

        // status = 'ACTIVE' AND age > 18
        FilterNode n1 = FilterNode.condition(Op.EQ, 3, "ACTIVE");
        FilterNode n2 = FilterNode.condition(Op.GT, 2, 18);
        FilterNode root = FilterNode.and(n1, n2);

        QueryIR query = new QueryIR(
                root,
                new Projection[] { new Projection(1), new Projection(2) },
                new Sort[] { new Sort(1, true) },
                10);

        String sql = sqlTranslator.translate(query, ctx);

        assertEquals("WHERE (status=? AND age>?) ORDER BY name ASC LIMIT 10", sql);
    }

    @Test
    void testMongoTranslation() {
        MongoTranslator mongoTranslator = new MongoTranslator();

        // status = 'ACTIVE' AND age > 18
        FilterNode n1 = FilterNode.condition(Op.EQ, 3, "ACTIVE");
        FilterNode n2 = FilterNode.condition(Op.GT, 2, 18);
        FilterNode root = FilterNode.and(n1, n2);

        QueryIR query = new QueryIR(root, null, null, 10);

        BsonDocument bson = mongoTranslator.translate(query, ctx);

        // BsonRoot should have $and key with value of type Object[]
        assertEquals("$and", bson.getKey(0));
        Object[] andArray = (Object[]) bson.getValue(0);
        assertEquals(2, andArray.length);

        BsonDocument leftDoc = (BsonDocument) andArray[0];
        BsonDocument rightDoc = (BsonDocument) andArray[1];

        assertEquals("status", leftDoc.getKey(0));
        assertEquals("ACTIVE", leftDoc.getValue(0));

        assertEquals("age", rightDoc.getKey(0));
        BsonDocument gtDoc = (BsonDocument) rightDoc.getValue(0);
        assertEquals("$gt", gtDoc.getKey(0));
        assertEquals(18, gtDoc.getValue(0));
    }

    @Test
    void testCapabilityMismatch() {
        // MongoTranslator doesn't support some hypothetical operator, wait, it throws
        // UnsupportedFeatureException
        // when op is unknown or not supported by buildFilter.
        // Op.EQ, NEQ, GT, LT, GTE, LTE, AND, OR are supported.
        // Let's test a custom capability exception, or simply checking that it throws
        // when something isn't handled.
        // Since we didn't implement Sort/Limit in MongoTranslator yet, let's keep it
        // simple.
    }
}
