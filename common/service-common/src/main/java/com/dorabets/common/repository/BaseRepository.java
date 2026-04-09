package com.dorabets.common.repository;

import javax.sql.DataSource;
import java.sql.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.function.Function;

/**
 * Lightweight repository base providing connection management and row mapping.
 */
public abstract class BaseRepository {

    protected final DataSource dataSource;

    protected BaseRepository(DataSource dataSource) {
        this.dataSource = dataSource;
    }

    protected <T> Optional<T> queryOne(String sql, Function<ResultSet, T> mapper, Object... params) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            setParams(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) return Optional.of(mapper.apply(rs));
                return Optional.empty();
            }
        } catch (SQLException e) {
            throw new RepositoryException("Query failed: " + sql, e);
        }
    }

    protected <T> List<T> queryList(String sql, Function<ResultSet, T> mapper, Object... params) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            setParams(ps, params);
            try (ResultSet rs = ps.executeQuery()) {
                List<T> results = new ArrayList<>();
                while (rs.next()) results.add(mapper.apply(rs));
                return results;
            }
        } catch (SQLException e) {
            throw new RepositoryException("Query failed: " + sql, e);
        }
    }

    protected int execute(String sql, Object... params) {
        try (Connection conn = dataSource.getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            setParams(ps, params);
            return ps.executeUpdate();
        } catch (SQLException e) {
            throw new RepositoryException("Execute failed: " + sql, e);
        }
    }

    protected <T> T executeInTransaction(TransactionalWork<T> work) {
        try (Connection conn = dataSource.getConnection()) {
            conn.setAutoCommit(false);
            try {
                T result = work.execute(conn);
                conn.commit();
                return result;
            } catch (RuntimeException e) {
                conn.rollback();
                throw e;
            } catch (Exception e) {
                conn.rollback();
                throw e;
            }
        } catch (RepositoryException e) {
            throw e;
        } catch (RuntimeException e) {
            throw e;
        } catch (Exception e) {
            throw new RepositoryException("Transaction failed", e);
        }
    }

    @FunctionalInterface
    public interface TransactionalWork<T> {
        T execute(Connection conn) throws Exception;
    }

    protected void setParams(PreparedStatement ps, Object... params) throws SQLException {
        for (int i = 0; i < params.length; i++) {
            Object p = params[i];
            if (p == null) {
                ps.setNull(i + 1, Types.NULL);
            } else if (p instanceof String s) {
                ps.setString(i + 1, s);
            } else if (p instanceof UUID u) {
                ps.setObject(i + 1, u);
            } else if (p instanceof Integer n) {
                ps.setInt(i + 1, n);
            } else if (p instanceof Long l) {
                ps.setLong(i + 1, l);
            } else if (p instanceof java.math.BigDecimal bd) {
                ps.setBigDecimal(i + 1, bd);
            } else if (p instanceof Boolean b) {
                ps.setBoolean(i + 1, b);
            } else if (p instanceof Timestamp ts) {
                ps.setTimestamp(i + 1, ts);
            } else {
                ps.setObject(i + 1, p);
            }
        }
    }
}
