package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseType;

import java.util.*;

/**
 * Amazon DynamoDB implementation.
 * Uses a client adapter pattern to work with AWS SDK.
 */
public class DynamoDatabase extends AbstractNoSqlDatabase {

    private final DynamoClientAdapter client;

    /**
     * Interface for DynamoDB client adapters.
     */
    public interface DynamoClientAdapter {
        /**
         * Initializes the DynamoDB client.
         */
        void initialize();

        /**
         * Closes the client.
         */
        void close();

        /**
         * Checks if initialized.
         */
        boolean isInitialized();

        /**
         * Lists table names.
         */
        List<String> listTables();

        /**
         * Checks if a table exists.
         */
        boolean tableExists(String tableName);

        /**
         * Creates a table.
         */
        void createTable(String tableName, String partitionKey, String sortKey);

        /**
         * Deletes a table.
         */
        void deleteTable(String tableName);

        /**
         * Gets a table adapter.
         */
        DynamoTableAdapter table(String tableName);
    }

    /**
     * Adapter for a DynamoDB table.
     */
    public interface DynamoTableAdapter {
        /**
         * Puts an item.
         */
        void putItem(Map<String, Object> item);

        /**
         * Gets an item by key.
         */
        Map<String, Object> getItem(Map<String, Object> key);

        /**
         * Updates an item.
         */
        void updateItem(Map<String, Object> key, Map<String, Object> updates);

        /**
         * Deletes an item.
         */
        void deleteItem(Map<String, Object> key);

        /**
         * Scans the table (expensive operation).
         */
        List<Map<String, Object>> scan();

        /**
         * Scans with a filter.
         */
        List<Map<String, Object>> scan(Map<String, Object> filter);

        /**
         * Queries with partition key.
         */
        List<Map<String, Object>> query(String partitionKeyName, Object partitionKeyValue);

        /**
         * Queries with partition key and sort key condition.
         */
        List<Map<String, Object>> query(String partitionKeyName, Object partitionKeyValue,
                                         String sortKeyName, String sortKeyCondition, Object sortKeyValue);

        /**
         * Batch write items.
         */
        void batchWrite(List<Map<String, Object>> items);

        /**
         * Batch delete items.
         */
        void batchDelete(List<Map<String, Object>> keys);

        /**
         * Gets the item count (approximate).
         */
        long getItemCount();
    }

    private DynamoDatabase(String name, DynamoClientAdapter client) {
        super(name, DatabaseType.DYNAMODB);
        this.client = client;
    }

    /**
     * Creates a DynamoDB database instance.
     *
     * @param name the logical name
     * @param client the DynamoDB client adapter
     * @return the database instance
     */
    public static DynamoDatabase create(String name, DynamoClientAdapter client) {
        return new DynamoDatabase(name, client);
    }

    @Override
    public void connect() {
        client.initialize();
        connected = true;
    }

    @Override
    public void disconnect() {
        connected = false;
        client.close();
    }

    @Override
    public boolean testConnection() {
        return client.isInitialized();
    }

    @Override
    public List<String> listCollections() {
        return client.listTables();
    }

    @Override
    public boolean collectionExists(String name) {
        return client.tableExists(name);
    }

    @Override
    protected NoSqlCollection createCollectionInstance(String name) {
        return new DynamoCollectionImpl(name, client.table(name));
    }

    @Override
    protected void doCreateCollection(String name) {
        // Default: partition key = "id", no sort key
        client.createTable(name, "id", null);
    }

    /**
     * Creates a table with specified keys.
     */
    public void createTable(String name, String partitionKey, String sortKey) {
        client.createTable(name, partitionKey, sortKey);
    }

    @Override
    protected boolean doDropCollection(String name) {
        try {
            client.deleteTable(name);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Gets the underlying DynamoDB client adapter.
     */
    public DynamoClientAdapter getClient() {
        return client;
    }

    /**
     * DynamoDB collection (table) implementation.
     */
    private class DynamoCollectionImpl extends AbstractNoSqlCollection {
        private final DynamoTableAdapter adapter;

        DynamoCollectionImpl(String name, DynamoTableAdapter adapter) {
            super(name);
            this.adapter = adapter;
        }

        @Override
        public String insert(Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                // Ensure document has an ID
                String id = (String) document.get("id");
                if (id == null) {
                    id = UUID.randomUUID().toString();
                    document = new HashMap<>(document);
                    document.put("id", id);
                }
                adapter.putItem(document);
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
            List<Map<String, Object>> docsWithIds = new ArrayList<>();
            
            for (Map<String, Object> doc : documents) {
                String id = (String) doc.get("id");
                if (id == null) {
                    id = UUID.randomUUID().toString();
                    doc = new HashMap<>(doc);
                    doc.put("id", id);
                }
                ids.add(id);
                docsWithIds.add(doc);
            }
            
            long start = System.nanoTime();
            try {
                adapter.batchWrite(docsWithIds);
                recordQuery(start, true);
                return ids;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "insertMany", e.getMessage(), e);
            }
        }

        @Override
        public Optional<Document> findById(String id) {
            long start = System.nanoTime();
            try {
                Map<String, Object> result = adapter.getItem(Map.of("id", id));
                recordQuery(start, true);
                if (result != null && !result.isEmpty()) {
                    return Optional.of(Document.of(result));
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
                    results = adapter.scan();
                } else if (query.containsKey("id") && query.size() == 1) {
                    // Query by partition key
                    results = adapter.query("id", query.get("id"));
                } else {
                    results = adapter.scan(query);
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
                adapter.updateItem(Map.of("id", id), updates);
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
                Map<String, Object> docWithId = new HashMap<>(document);
                docWithId.put("id", id);
                adapter.putItem(docWithId);
                recordQuery(start, true);
                return true;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "replaceById", e.getMessage(), e);
            }
        }

        @Override
        public String upsert(Map<String, Object> query, Map<String, Object> document) {
            String id = (String) query.get("id");
            if (id == null) {
                id = (String) document.get("id");
            }
            if (id == null) {
                id = UUID.randomUUID().toString();
            }
            
            Map<String, Object> docWithId = new HashMap<>(document);
            docWithId.put("id", id);
            adapter.putItem(docWithId);
            return id;
        }

        @Override
        public boolean deleteById(String id) {
            long start = System.nanoTime();
            try {
                adapter.deleteItem(Map.of("id", id));
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
            if (!docs.isEmpty()) {
                List<Map<String, Object>> keys = docs.stream()
                        .map(d -> Map.<String, Object>of("id", d.getString("id")))
                        .toList();
                adapter.batchDelete(keys);
            }
            return docs.size();
        }

        @Override
        public long count(Map<String, Object> query) {
            if (query.isEmpty()) {
                return adapter.getItemCount();
            }
            return find(query).size();
        }
    }
}
