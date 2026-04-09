package com.natsu.common.model.database.nosql;

import java.util.*;

/**
 * Fluent query builder for NoSQL queries.
 */
public class NoSqlQueryBuilder {

    private final NoSqlCollection collection;
    private final Map<String, Object> filters = new LinkedHashMap<>();
    private final List<String> projections = new ArrayList<>();
    private final List<SortField> sorts = new ArrayList<>();
    private Integer limit;
    private Integer skip;

    public NoSqlQueryBuilder(NoSqlCollection collection) {
        this.collection = collection;
    }

    /**
     * Adds an equality filter.
     *
     * @param field the field name
     * @param value the value to match
     * @return this builder
     */
    public NoSqlQueryBuilder eq(String field, Object value) {
        filters.put(field, value);
        return this;
    }

    /**
     * Adds a not-equal filter.
     *
     * @param field the field name
     * @param value the value
     * @return this builder
     */
    public NoSqlQueryBuilder ne(String field, Object value) {
        filters.put(field, Map.of("$ne", value));
        return this;
    }

    /**
     * Adds a greater-than filter.
     *
     * @param field the field name
     * @param value the value
     * @return this builder
     */
    public NoSqlQueryBuilder gt(String field, Object value) {
        filters.put(field, Map.of("$gt", value));
        return this;
    }

    /**
     * Adds a greater-than-or-equal filter.
     *
     * @param field the field name
     * @param value the value
     * @return this builder
     */
    public NoSqlQueryBuilder gte(String field, Object value) {
        filters.put(field, Map.of("$gte", value));
        return this;
    }

    /**
     * Adds a less-than filter.
     *
     * @param field the field name
     * @param value the value
     * @return this builder
     */
    public NoSqlQueryBuilder lt(String field, Object value) {
        filters.put(field, Map.of("$lt", value));
        return this;
    }

    /**
     * Adds a less-than-or-equal filter.
     *
     * @param field the field name
     * @param value the value
     * @return this builder
     */
    public NoSqlQueryBuilder lte(String field, Object value) {
        filters.put(field, Map.of("$lte", value));
        return this;
    }

    /**
     * Adds an "in" filter (value in list).
     *
     * @param field the field name
     * @param values the values
     * @return this builder
     */
    public NoSqlQueryBuilder in(String field, Object... values) {
        filters.put(field, Map.of("$in", Arrays.asList(values)));
        return this;
    }

    /**
     * Adds a "not in" filter.
     *
     * @param field the field name
     * @param values the values
     * @return this builder
     */
    public NoSqlQueryBuilder notIn(String field, Object... values) {
        filters.put(field, Map.of("$nin", Arrays.asList(values)));
        return this;
    }

    /**
     * Adds a regex filter.
     *
     * @param field the field name
     * @param pattern the regex pattern
     * @return this builder
     */
    public NoSqlQueryBuilder regex(String field, String pattern) {
        filters.put(field, Map.of("$regex", pattern));
        return this;
    }

    /**
     * Adds a contains filter (for strings).
     *
     * @param field the field name
     * @param substring the substring to find
     * @return this builder
     */
    public NoSqlQueryBuilder contains(String field, String substring) {
        return regex(field, ".*" + substring + ".*");
    }

    /**
     * Adds a starts-with filter.
     *
     * @param field the field name
     * @param prefix the prefix
     * @return this builder
     */
    public NoSqlQueryBuilder startsWith(String field, String prefix) {
        return regex(field, "^" + prefix);
        }

    /**
     * Adds an exists filter.
     *
     * @param field the field name
     * @param exists true to check existence, false for non-existence
     * @return this builder
     */
    public NoSqlQueryBuilder exists(String field, boolean exists) {
        filters.put(field, Map.of("$exists", exists));
        return this;
    }

    /**
     * Adds a null check.
     *
     * @param field the field name
     * @return this builder
     */
    public NoSqlQueryBuilder isNull(String field) {
        filters.put(field, null);
        return this;
    }

    /**
     * Adds a not-null check.
     *
     * @param field the field name
     * @return this builder
     */
    public NoSqlQueryBuilder isNotNull(String field) {
        filters.put(field, Map.of("$ne", null));
        return this;
    }

    /**
     * Adds a range filter (between).
     *
     * @param field the field name
     * @param min the minimum value
     * @param max the maximum value
     * @return this builder
     */
    public NoSqlQueryBuilder between(String field, Object min, Object max) {
        filters.put(field, Map.of("$gte", min, "$lte", max));
        return this;
    }

    /**
     * Specifies fields to return (projection).
     *
     * @param fields the field names
     * @return this builder
     */
    public NoSqlQueryBuilder select(String... fields) {
        projections.addAll(Arrays.asList(fields));
        return this;
    }

    /**
     * Adds ascending sort.
     *
     * @param field the field to sort by
     * @return this builder
     */
    public NoSqlQueryBuilder orderBy(String field) {
        sorts.add(new SortField(field, true));
        return this;
    }

    /**
     * Adds descending sort.
     *
     * @param field the field to sort by
     * @return this builder
     */
    public NoSqlQueryBuilder orderByDesc(String field) {
        sorts.add(new SortField(field, false));
        return this;
    }

    /**
     * Sets the limit.
     *
     * @param limit the maximum number of results
     * @return this builder
     */
    public NoSqlQueryBuilder limit(int limit) {
        this.limit = limit;
        return this;
    }

    /**
     * Sets the skip (offset).
     *
     * @param skip the number of results to skip
     * @return this builder
     */
    public NoSqlQueryBuilder skip(int skip) {
        this.skip = skip;
        return this;
    }

    /**
     * Sets pagination.
     *
     * @param page the page number (1-based)
     * @param pageSize the page size
     * @return this builder
     */
    public NoSqlQueryBuilder paginate(int page, int pageSize) {
        this.limit = pageSize;
        this.skip = (page - 1) * pageSize;
        return this;
    }

    /**
     * Gets the filter map.
     *
     * @return the filters
     */
    public Map<String, Object> getFilters() {
        return filters;
    }

    /**
     * Gets the projection fields.
     *
     * @return the projections
     */
    public List<String> getProjections() {
        return projections;
    }

    /**
     * Gets the sort fields.
     *
     * @return the sorts
     */
    public List<SortField> getSorts() {
        return sorts;
    }

    /**
     * Gets the limit.
     *
     * @return the limit, or null
     */
    public Integer getLimit() {
        return limit;
    }

    /**
     * Gets the skip.
     *
     * @return the skip, or null
     */
    public Integer getSkip() {
        return skip;
    }

    /**
     * Executes the query.
     *
     * @return list of matching documents
     */
    public List<Document> execute() {
        return collection.find(filters);
    }

    /**
     * Executes the query and returns the first result.
     *
     * @return the first document, or empty
     */
    public Optional<Document> first() {
        return limit(1).execute().stream().findFirst();
    }

    /**
     * Counts matching documents.
     *
     * @return the count
     */
    public long count() {
        return collection.count(filters);
    }

    /**
     * Checks if any documents match.
     *
     * @return true if any match
     */
    public boolean exists() {
        return count() > 0;
    }

    /**
     * Represents a sort field.
     */
    public record SortField(String field, boolean ascending) {}
}
