package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseType;

import java.util.*;

/**
 * Apache Cassandra database implementation.
 * Uses a client adapter pattern to work with any Cassandra driver.
 */
public class CassandraDatabase extends AbstractNoSqlDatabase {

    private final CassandraClientAdapter client;
    private final String keyspace;

    /**
     * Interface for Cassandra client adapters.
     */
    public interface CassandraClientAdapter {
        /**
         * Connects to Cassandra.
         */
        void connect();

        /**
         * Disconnects from Cassandra.
         */
        void disconnect();

        /**
         * Checks if connected.
         */
        boolean isConnected();

        /**
         * Executes a CQL statement.
         */
        void execute(String cql);

        /**
         * Executes a CQL statement with parameters.
         */
        void execute(String cql, Object... params);

        /**
         * Queries and returns results.
         */
        List<Map<String, Object>> query(String cql);

        /**
         * Queries with parameters and returns results.
         */
        List<Map<String, Object>> query(String cql, Object... params);

        /**
         * Lists keyspaces.
         */
        List<String> listKeyspaces();

        /**
         * Lists tables in a keyspace.
         */
        List<String> listTables(String keyspace);

        /**
         * Creates a keyspace.
         */
        void createKeyspace(String keyspace, int replicationFactor);

        /**
         * Drops a keyspace.
         */
        void dropKeyspace(String keyspace);

        /**
         * Creates a table.
         */
        void createTable(String keyspace, String table, String schema);

        /**
         * Drops a table.
         */
        void dropTable(String keyspace, String table);

        /**
         * Gets the table adapter.
         */
        CassandraTableAdapter table(String keyspace, String table);
    }

    /**
     * Adapter for a Cassandra table.
     */
    public interface CassandraTableAdapter {
        /**
         * Inserts a row.
         */
        void insert(Map<String, Object> row);

        /**
         * Inserts a row with TTL.
         */
        void insert(Map<String, Object> row, int ttlSeconds);

        /**
         * Selects all rows.
         */
        List<Map<String, Object>> selectAll();

        /**
         * Selects rows by partition key.
         */
        List<Map<String, Object>> selectByPartitionKey(String keyName, Object keyValue);

        /**
         * Selects rows by partition and clustering keys.
         */
        List<Map<String, Object>> select(Map<String, Object> keys);

        /**
         * Updates a row.
         */
        void update(Map<String, Object> keys, Map<String, Object> values);

        /**
         * Deletes rows by keys.
         */
        void delete(Map<String, Object> keys);

        /**
         * Counts rows (expensive operation).
         */
        long count();
    }

    private CassandraDatabase(String name, CassandraClientAdapter client, String keyspace) {
        super(name, DatabaseType.CASSANDRA);
        this.client = client;
        this.keyspace = keyspace;
    }

    /**
     * Creates a Cassandra database instance.
     *
     * @param name the logical name
     * @param client the Cassandra client adapter
     * @param keyspace the keyspace name
     * @return the database instance
     */
    public static CassandraDatabase create(String name, CassandraClientAdapter client, String keyspace) {
        return new CassandraDatabase(name, client, keyspace);
    }

    @Override
    public void connect() {
        client.connect();
        connected = true;
    }

    @Override
    public void disconnect() {
        connected = false;
        client.disconnect();
    }

    @Override
    public boolean testConnection() {
        return client.isConnected();
    }

    @Override
    public List<String> listCollections() {
        return client.listTables(keyspace);
    }

    @Override
    public boolean collectionExists(String name) {
        return listCollections().contains(name);
    }

    @Override
    protected NoSqlCollection createCollectionInstance(String name) {
        return new CassandraCollectionImpl(name, client.table(keyspace, name));
    }

    @Override
    protected void doCreateCollection(String name) {
        // Create a simple table with id as partition key and data as blob
        String schema = "id text PRIMARY KEY, data text, created_at timestamp";
        client.createTable(keyspace, name, schema);
    }

    /**
     * Creates a table with custom schema.
     */
    public void createTable(String name, String schema) {
        client.createTable(keyspace, name, schema);
    }

    @Override
    protected boolean doDropCollection(String name) {
        try {
            client.dropTable(keyspace, name);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Creates the keyspace if it doesn't exist.
     */
    public void createKeyspace(int replicationFactor) {
        client.createKeyspace(keyspace, replicationFactor);
    }

    /**
     * Gets the underlying Cassandra client adapter.
     */
    public CassandraClientAdapter getClient() {
        return client;
    }

    /**
     * Gets the keyspace name.
     */
    public String getKeyspace() {
        return keyspace;
    }

    /**
     * Cassandra collection (table) implementation.
     */
    private class CassandraCollectionImpl extends AbstractNoSqlCollection {
        private final CassandraTableAdapter adapter;

        CassandraCollectionImpl(String name, CassandraTableAdapter adapter) {
            super(name);
            this.adapter = adapter;
        }

        @Override
        public String insert(Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                String id = (String) document.get("id");
                if (id == null) {
                    id = UUID.randomUUID().toString();
                    document = new HashMap<>(document);
                    document.put("id", id);
                }
                adapter.insert(document);
                recordQuery(start, true);
                return id;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "insert", e.getMessage(), e);
            }
        }

        @Override
        public List<String> insertMany(List<Map<String, Object>> documents) {
            List<String> ids = new ArrayList<>();
            for (Map<String, Object> doc : documents) {
                ids.add(insert(doc));
            }
            return ids;
        }

        @Override
        public Optional<Document> findById(String id) {
            long start = System.nanoTime();
            try {
                List<Map<String, Object>> results = adapter.selectByPartitionKey("id", id);
                recordQuery(start, true);
                if (!results.isEmpty()) {
                    return Optional.of(Document.of(results.get(0)));
                }
                return Optional.empty();
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "findById", e.getMessage(), e);
            }
        }

        @Override
        public List<Document> find(Map<String, Object> query) {
            long start = System.nanoTime();
            try {
                List<Map<String, Object>> results;
                if (query.isEmpty()) {
                    results = adapter.selectAll();
                } else if (query.size() == 1 && query.containsKey("id")) {
                    results = adapter.selectByPartitionKey("id", query.get("id"));
                } else {
                    // For complex queries, we need to filter in memory
                    // (Cassandra doesn't support arbitrary WHERE clauses)
                    results = adapter.selectAll();
                    results = results.stream()
                            .filter(row -> matchesQuery(row, query))
                            .toList();
                }
                recordQuery(start, true);
                return results.stream().map(Document::of).toList();
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "find", e.getMessage(), e);
            }
        }

        @Override
        public List<Document> findAll() {
            return find(Map.of());
        }

        @Override
        public boolean updateById(String id, Map<String, Object> updates) {
            long start = System.nanoTime();
            try {
                adapter.update(Map.of("id", id), updates);
                recordQuery(start, true);
                return true;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "updateById", e.getMessage(), e);
            }
        }

        @Override
        public long update(Map<String, Object> query, Map<String, Object> updates) {
            List<Document> docs = find(query);
            for (Document doc : docs) {
                updateById(doc.getString("id"), updates);
            }
            return docs.size();
        }

        @Override
        public boolean replaceById(String id, Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                // Delete and re-insert
                adapter.delete(Map.of("id", id));
                document = new HashMap<>(document);
                document.put("id", id);
                adapter.insert(document);
                recordQuery(start, true);
                return true;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "replaceById", e.getMessage(), e);
            }
        }

        @Override
        public String upsert(Map<String, Object> query, Map<String, Object> document) {
            // Cassandra INSERT is effectively an upsert
            String id = (String) query.get("id");
            if (id == null) {
                id = (String) document.get("id");
            }
            if (id == null) {
                id = UUID.randomUUID().toString();
            }
            document = new HashMap<>(document);
            document.put("id", id);
            adapter.insert(document);
            return id;
        }

        @Override
        public boolean deleteById(String id) {
            long start = System.nanoTime();
            try {
                adapter.delete(Map.of("id", id));
                recordQuery(start, true);
                return true;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "deleteById", e.getMessage(), e);
            }
        }

        @Override
        public long delete(Map<String, Object> query) {
            List<Document> docs = find(query);
            for (Document doc : docs) {
                deleteById(doc.getString("id"));
            }
            return docs.size();
        }

        @Override
        public long count(Map<String, Object> query) {
            if (query.isEmpty()) {
                return adapter.count();
            }
            return find(query).size();
        }

        private boolean matchesQuery(Map<String, Object> row, Map<String, Object> query) {
            for (Map.Entry<String, Object> entry : query.entrySet()) {
                Object rowValue = row.get(entry.getKey());
                if (!Objects.equals(entry.getValue(), rowValue)) {
                    return false;
                }
            }
            return true;
        }
    }
}
