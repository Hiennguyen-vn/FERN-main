package com.natsu.common.model.database.sql;

import com.natsu.common.model.database.DatabaseException;

import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.*;
import java.util.stream.Stream;

/**
 * Represents the result of a SQL query.
 * Provides convenient methods for accessing data.
 */
public class SqlResult implements Iterable<SqlResult.Row>, AutoCloseable {

    private final List<String> columns;
    private final List<Row> rows;

    private SqlResult(List<String> columns, List<Row> rows) {
        this.columns = columns;
        this.rows = rows;
    }

    /**
     * Creates a SqlResult from a JDBC ResultSet.
     *
     * @param rs the result set
     * @return the SqlResult
     */
    public static SqlResult from(ResultSet rs) {
        try {
            ResultSetMetaData meta = rs.getMetaData();
            int columnCount = meta.getColumnCount();
            
            List<String> columns = new ArrayList<>(columnCount);
            for (int i = 1; i <= columnCount; i++) {
                columns.add(meta.getColumnLabel(i).toLowerCase());
            }
            
            List<Row> rows = new ArrayList<>();
            while (rs.next()) {
                Map<String, Object> data = new LinkedHashMap<>();
                for (int i = 1; i <= columnCount; i++) {
                    data.put(columns.get(i - 1), rs.getObject(i));
                }
                rows.add(new Row(columns, data));
            }
            
            rs.close();
            return new SqlResult(columns, rows);
        } catch (SQLException e) {
            throw new DatabaseException("Failed to read result set", e);
        }
    }

    /**
     * Creates an empty result.
     *
     * @return an empty SqlResult
     */
    public static SqlResult empty() {
        return new SqlResult(List.of(), List.of());
    }

    /**
     * Gets the column names.
     *
     * @return list of column names
     */
    public List<String> getColumns() {
        return columns;
    }

    /**
     * Gets all rows.
     *
     * @return list of rows
     */
    public List<Row> getRows() {
        return rows;
    }

    /**
     * Gets the number of rows.
     *
     * @return the row count
     */
    public int size() {
        return rows.size();
    }

    /**
     * Checks if the result is empty.
     *
     * @return true if no rows
     */
    public boolean isEmpty() {
        return rows.isEmpty();
    }

    /**
     * Gets the first row.
     *
     * @return the first row, or empty if no rows
     */
    public Optional<Row> first() {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    /**
     * Gets a row by index.
     *
     * @param index the row index
     * @return the row
     */
    public Row get(int index) {
        return rows.get(index);
    }

    /**
     * Gets a single value from the first row.
     *
     * @param column the column name
     * @param type the expected type
     * @param <T> the type
     * @return the value, or empty if not found
     */
    public <T> Optional<T> getSingleValue(String column, Class<T> type) {
        return first().map(row -> row.get(column, type));
    }

    /**
     * Gets all values from a column.
     *
     * @param column the column name
     * @param type the expected type
     * @param <T> the type
     * @return list of values
     */
    public <T> List<T> getColumnValues(String column, Class<T> type) {
        List<T> values = new ArrayList<>();
        for (Row row : rows) {
            T value = row.get(column, type);
            if (value != null) {
                values.add(value);
            }
        }
        return values;
    }

    /**
     * Maps rows to objects.
     *
     * @param mapper the row mapper
     * @param <T> the result type
     * @return list of mapped objects
     */
    public <T> List<T> map(RowMapper<T> mapper) {
        List<T> result = new ArrayList<>();
        for (Row row : rows) {
            result.add(mapper.map(row));
        }
        return result;
    }

    /**
     * Maps the first row to an object.
     *
     * @param mapper the row mapper
     * @param <T> the result type
     * @return the mapped object, or empty
     */
    public <T> Optional<T> mapFirst(RowMapper<T> mapper) {
        return first().map(mapper::map);
    }

    /**
     * Creates a stream of rows.
     *
     * @return a stream
     */
    public Stream<Row> stream() {
        return rows.stream();
    }

    @Override
    public Iterator<Row> iterator() {
        return rows.iterator();
    }

    @Override
    public void close() {
        // Result is already materialized, nothing to close
    }

    /**
     * Functional interface for mapping rows to objects.
     *
     * @param <T> the result type
     */
    @FunctionalInterface
    public interface RowMapper<T> {
        T map(Row row);
    }

    /**
     * Represents a single row in the result.
     */
    public static class Row {
        private final List<String> columns;
        private final Map<String, Object> data;

        Row(List<String> columns, Map<String, Object> data) {
            this.columns = columns;
            this.data = data;
        }

        /**
         * Gets a value by column name.
         *
         * @param column the column name
         * @return the value, or null
         */
        public Object get(String column) {
            return data.get(column.toLowerCase());
        }

        /**
         * Gets a typed value by column name.
         *
         * @param column the column name
         * @param type the expected type
         * @param <T> the type
         * @return the value
         */
        @SuppressWarnings("unchecked")
        public <T> T get(String column, Class<T> type) {
            Object value = get(column);
            if (value == null) {
                return null;
            }
            if (type.isInstance(value)) {
                return (T) value;
            }
            // Handle common conversions
            if (type == String.class) {
                return (T) value.toString();
            }
            if (type == Integer.class && value instanceof Number) {
                return (T) Integer.valueOf(((Number) value).intValue());
            }
            if (type == Long.class && value instanceof Number) {
                return (T) Long.valueOf(((Number) value).longValue());
            }
            if (type == Double.class && value instanceof Number) {
                return (T) Double.valueOf(((Number) value).doubleValue());
            }
            if (type == Boolean.class) {
                if (value instanceof Number) {
                    return (T) Boolean.valueOf(((Number) value).intValue() != 0);
                }
                return (T) Boolean.valueOf(value.toString());
            }
            throw new DatabaseException("Cannot convert " + value.getClass() + " to " + type);
        }

        /**
         * Gets a value with a default.
         *
         * @param column the column name
         * @param defaultValue the default value
         * @param <T> the type
         * @return the value or default
         */
        @SuppressWarnings("unchecked")
        public <T> T getOrDefault(String column, T defaultValue) {
            Object value = get(column);
            if (value == null) {
                return defaultValue;
            }
            return (T) value;
        }

        public String getString(String column) {
            return get(column, String.class);
        }

        public Integer getInt(String column) {
            return get(column, Integer.class);
        }

        public Long getLong(String column) {
            return get(column, Long.class);
        }

        public Double getDouble(String column) {
            return get(column, Double.class);
        }

        public Boolean getBoolean(String column) {
            return get(column, Boolean.class);
        }

        public java.time.LocalDateTime getDateTime(String column) {
            Object value = get(column);
            if (value == null) return null;
            if (value instanceof java.sql.Timestamp) {
                return ((java.sql.Timestamp) value).toLocalDateTime();
            }
            if (value instanceof java.time.LocalDateTime) {
                return (java.time.LocalDateTime) value;
            }
            throw new DatabaseException("Cannot convert " + value.getClass() + " to LocalDateTime");
        }

        public java.time.LocalDate getDate(String column) {
            Object value = get(column);
            if (value == null) return null;
            if (value instanceof java.sql.Date) {
                return ((java.sql.Date) value).toLocalDate();
            }
            if (value instanceof java.time.LocalDate) {
                return (java.time.LocalDate) value;
            }
            throw new DatabaseException("Cannot convert " + value.getClass() + " to LocalDate");
        }

        /**
         * Checks if a column value is null.
         *
         * @param column the column name
         * @return true if null
         */
        public boolean isNull(String column) {
            return get(column) == null;
        }

        /**
         * Gets all column names.
         *
         * @return the columns
         */
        public List<String> getColumns() {
            return columns;
        }

        /**
         * Converts the row to a map.
         *
         * @return map of column to value
         */
        public Map<String, Object> toMap() {
            return new LinkedHashMap<>(data);
        }

        @Override
        public String toString() {
            return data.toString();
        }
    }
}
