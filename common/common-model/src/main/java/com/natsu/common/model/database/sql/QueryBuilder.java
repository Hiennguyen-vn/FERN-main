package com.natsu.common.model.database.sql;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Fluent query builder for constructing SQL queries.
 */
public class QueryBuilder {

    private final SqlDatabase database;
    private final String table;
    
    private final List<String> selectColumns = new ArrayList<>();
    private final List<String> joins = new ArrayList<>();
    private final List<WhereClause> whereClauses = new ArrayList<>();
    private final List<Object> parameters = new ArrayList<>();
    private final List<String> groupBy = new ArrayList<>();
    private final List<String> orderBy = new ArrayList<>();
    private Integer limit;
    private Integer offset;
    private boolean distinct = false;

    public QueryBuilder(SqlDatabase database, String table) {
        this.database = database;
        this.table = table;
    }

    /**
     * Specifies columns to select.
     *
     * @param columns the columns
     * @return this builder
     */
    public QueryBuilder columns(String... columns) {
        selectColumns.addAll(Arrays.asList(columns));
        return this;
    }

    /**
     * Selects all columns.
     *
     * @return this builder
     */
    public QueryBuilder all() {
        selectColumns.clear();
        selectColumns.add("*");
        return this;
    }

    /**
     * Adds DISTINCT to the query.
     *
     * @return this builder
     */
    public QueryBuilder distinct() {
        this.distinct = true;
        return this;
    }

    /**
     * Adds a WHERE condition.
     *
     * @param column the column
     * @param operator the operator (=, <, >, LIKE, etc.)
     * @param value the value
     * @return this builder
     */
    public QueryBuilder where(String column, String operator, Object value) {
        whereClauses.add(new WhereClause("AND", column, operator, false));
        parameters.add(value);
        return this;
    }

    /**
     * Adds a WHERE equals condition.
     *
     * @param column the column
     * @param value the value
     * @return this builder
     */
    public QueryBuilder where(String column, Object value) {
        return where(column, "=", value);
    }

    /**
     * Adds an OR WHERE condition.
     *
     * @param column the column
     * @param operator the operator
     * @param value the value
     * @return this builder
     */
    public QueryBuilder orWhere(String column, String operator, Object value) {
        whereClauses.add(new WhereClause("OR", column, operator, false));
        parameters.add(value);
        return this;
    }

    /**
     * Adds a WHERE IN condition.
     *
     * @param column the column
     * @param values the values
     * @return this builder
     */
    public QueryBuilder whereIn(String column, Object... values) {
        String placeholders = Arrays.stream(values).map(v -> "?").collect(Collectors.joining(", "));
        whereClauses.add(new WhereClause("AND", column + " IN (" + placeholders + ")", "", true));
        parameters.addAll(Arrays.asList(values));
        return this;
    }

    /**
     * Adds a WHERE IS NULL condition.
     *
     * @param column the column
     * @return this builder
     */
    public QueryBuilder whereNull(String column) {
        whereClauses.add(new WhereClause("AND", column + " IS NULL", "", true));
        return this;
    }

    /**
     * Adds a WHERE IS NOT NULL condition.
     *
     * @param column the column
     * @return this builder
     */
    public QueryBuilder whereNotNull(String column) {
        whereClauses.add(new WhereClause("AND", column + " IS NOT NULL", "", true));
        return this;
    }

    /**
     * Adds a WHERE BETWEEN condition.
     *
     * @param column the column
     * @param start the start value
     * @param end the end value
     * @return this builder
     */
    public QueryBuilder whereBetween(String column, Object start, Object end) {
        whereClauses.add(new WhereClause("AND", column + " BETWEEN ? AND ?", "", true));
        parameters.add(start);
        parameters.add(end);
        return this;
    }

    /**
     * Adds a LIKE condition.
     *
     * @param column the column
     * @param pattern the pattern
     * @return this builder
     */
    public QueryBuilder whereLike(String column, String pattern) {
        return where(column, "LIKE", pattern);
    }

    /**
     * Adds an INNER JOIN.
     *
     * @param joinTable the table to join
     * @param condition the join condition
     * @return this builder
     */
    public QueryBuilder join(String joinTable, String condition) {
        joins.add("INNER JOIN " + joinTable + " ON " + condition);
        return this;
    }

    /**
     * Adds a LEFT JOIN.
     *
     * @param joinTable the table to join
     * @param condition the join condition
     * @return this builder
     */
    public QueryBuilder leftJoin(String joinTable, String condition) {
        joins.add("LEFT JOIN " + joinTable + " ON " + condition);
        return this;
    }

    /**
     * Adds a RIGHT JOIN.
     *
     * @param joinTable the table to join
     * @param condition the join condition
     * @return this builder
     */
    public QueryBuilder rightJoin(String joinTable, String condition) {
        joins.add("RIGHT JOIN " + joinTable + " ON " + condition);
        return this;
    }

    /**
     * Adds GROUP BY columns.
     *
     * @param columns the columns
     * @return this builder
     */
    public QueryBuilder groupBy(String... columns) {
        groupBy.addAll(Arrays.asList(columns));
        return this;
    }

    /**
     * Adds ORDER BY columns.
     *
     * @param column the column
     * @return this builder
     */
    public QueryBuilder orderBy(String column) {
        orderBy.add(column);
        return this;
    }

    /**
     * Adds ORDER BY DESC.
     *
     * @param column the column
     * @return this builder
     */
    public QueryBuilder orderByDesc(String column) {
        orderBy.add(column + " DESC");
        return this;
    }

    /**
     * Sets the LIMIT.
     *
     * @param limit the limit
     * @return this builder
     */
    public QueryBuilder limit(int limit) {
        this.limit = limit;
        return this;
    }

    /**
     * Sets the OFFSET.
     *
     * @param offset the offset
     * @return this builder
     */
    public QueryBuilder offset(int offset) {
        this.offset = offset;
        return this;
    }

    /**
     * Sets LIMIT and OFFSET for pagination.
     *
     * @param page the page number (1-based)
     * @param pageSize the page size
     * @return this builder
     */
    public QueryBuilder paginate(int page, int pageSize) {
        this.limit = pageSize;
        this.offset = (page - 1) * pageSize;
        return this;
    }

    /**
     * Builds the SQL query.
     *
     * @return the SQL string
     */
    public String buildSql() {
        StringBuilder sql = new StringBuilder("SELECT ");
        
        if (distinct) {
            sql.append("DISTINCT ");
        }
        
        if (selectColumns.isEmpty()) {
            sql.append("*");
        } else {
            sql.append(String.join(", ", selectColumns));
        }
        
        sql.append(" FROM ").append(table);
        
        for (String join : joins) {
            sql.append(" ").append(join);
        }
        
        if (!whereClauses.isEmpty()) {
            sql.append(" WHERE ");
            boolean first = true;
            for (WhereClause clause : whereClauses) {
                if (!first) {
                    sql.append(" ").append(clause.conjunction).append(" ");
                }
                if (clause.raw) {
                    sql.append(clause.column);
                } else {
                    sql.append(clause.column).append(" ").append(clause.operator).append(" ?");
                }
                first = false;
            }
        }
        
        if (!groupBy.isEmpty()) {
            sql.append(" GROUP BY ").append(String.join(", ", groupBy));
        }
        
        if (!orderBy.isEmpty()) {
            sql.append(" ORDER BY ").append(String.join(", ", orderBy));
        }
        
        if (limit != null) {
            sql.append(" LIMIT ").append(limit);
        }
        
        if (offset != null) {
            sql.append(" OFFSET ").append(offset);
        }
        
        return sql.toString();
    }

    /**
     * Gets the query parameters.
     *
     * @return the parameters
     */
    public Object[] getParameters() {
        return parameters.toArray();
    }

    /**
     * Executes the query and returns results.
     *
     * @return the results
     */
    public SqlResult execute() {
        return database.query(buildSql(), getParameters());
    }

    /**
     * Executes and returns the first result.
     *
     * @return the first row, or empty
     */
    public java.util.Optional<SqlResult.Row> first() {
        return limit(1).execute().first();
    }

    /**
     * Executes and maps results.
     *
     * @param mapper the row mapper
     * @param <T> the result type
     * @return list of mapped objects
     */
    public <T> List<T> map(SqlResult.RowMapper<T> mapper) {
        return execute().map(mapper);
    }

    /**
     * Executes and counts the results.
     *
     * @return the count
     */
    public long count() {
        List<String> originalColumns = new ArrayList<>(selectColumns);
        selectColumns.clear();
        selectColumns.add("COUNT(*) as count");
        
        SqlResult result = execute();
        
        selectColumns.clear();
        selectColumns.addAll(originalColumns);
        
        return result.first()
                .map(row -> row.getLong("count"))
                .orElse(0L);
    }

    /**
     * Checks if any rows exist.
     *
     * @return true if rows exist
     */
    public boolean exists() {
        return limit(1).count() > 0;
    }

    private record WhereClause(String conjunction, String column, String operator, boolean raw) {}
}
