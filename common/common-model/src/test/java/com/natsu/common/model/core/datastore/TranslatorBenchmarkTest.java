package com.natsu.common.model.core.datastore;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertTrue;

class TranslatorBenchmarkTest {

    private final TranslationContext ctx = new TranslationContext() {
        @Override
        public String getFieldName(int fieldId) {
            return "field_" + fieldId;
        }
    };

    @Test
    void benchmarkSqlTranslationLatency() {
        SqlTranslator translator = new SqlTranslator();

        FilterNode root = FilterNode.condition(Op.EQ, 1, "test");
        QueryIR query = new QueryIR(root, QueryIR.NO_PROJECTIONS, QueryIR.NO_SORTS, 0);

        // Warm up
        for (int i = 0; i < 10000; i++) {
            translator.translate(query, ctx);
        }

        // Measure
        long start = System.nanoTime();
        for (int i = 0; i < 10000; i++) {
            translator.translate(query, ctx);
        }
        long end = System.nanoTime();

        long avgNanos = (end - start) / 10000;

        System.out.println("SQL Translation Avg Latency: " + avgNanos + " ns");

        // Assert less than 5000 ns (5us)
        assertTrue(avgNanos < 5000, "Translation took too long: " + avgNanos + " ns (Target < 5000 ns)");
    }
}
