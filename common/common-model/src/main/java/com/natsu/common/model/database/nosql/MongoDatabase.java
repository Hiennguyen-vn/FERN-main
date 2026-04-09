package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseType;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * MongoDB database implementation.
 * Uses a client adapter pattern to work with any MongoDB driver.
 */
public class MongoDatabase extends AbstractNoSqlDatabase {

    private final MongoClientAdapter client;
    private final String databaseName;

    /**
     * Interface for MongoDB client adapters.
     * Implement this to use the official MongoDB driver or any other driver.
     */
    public interface MongoClientAdapter {
        /**
         * Connects to MongoDB.
         */
        void connect();

        /**
         * Disconnects from MongoDB.
         */
        void disconnect();

        /**
         * Checks if connected.
         */
        boolean isConnected();

        /**
         * Pings the server.
         */
        boolean ping();

        /**
         * Gets a database.
         */
        MongoDatabaseAdapter getDatabase(String name);

        /**
         * Lists database names.
         */
        List<String> listDatabaseNames();
    }

    /**
     * Adapter for a MongoDB database.
     */
    public interface MongoDatabaseAdapter {
        /**
         * Gets a collection.
         */
        MongoCollectionAdapter getCollection(String name);

        /**
         * Lists collection names.
         */
        List<String> listCollectionNames();

        /**
         * Creates a collection.
         */
        void createCollection(String name);

        /**
         * Drops a collection.
         */
        void dropCollection(String name);
    }

    /**
     * Adapter for a MongoDB collection.
     */
    public interface MongoCollectionAdapter {
        /**
         * Inserts a document.
         */
        String insertOne(Map<String, Object> document);

        /**
         * Inserts multiple documents.
         */
        List<String> insertMany(List<Map<String, Object>> documents);

        /**
         * Finds documents matching a filter.
         */
        List<Map<String, Object>> find(Map<String, Object> filter);

        /**
         * Finds a document by ID.
         */
        Map<String, Object> findById(String id);

        /**
         * Updates a document by ID.
         */
        boolean updateById(String id, Map<String, Object> updates);

        /**
         * Updates documents matching a filter.
         */
        long updateMany(Map<String, Object> filter, Map<String, Object> updates);

        /**
         * Replaces a document by ID.
         */
        boolean replaceById(String id, Map<String, Object> replacement);

        /**
         * Deletes a document by ID.
         */
        boolean deleteById(String id);

        /**
         * Deletes documents matching a filter.
         */
        long deleteMany(Map<String, Object> filter);

        /**
         * Counts documents matching a filter.
         */
        long count(Map<String, Object> filter);

        /**
         * Creates an index.
         */
        void createIndex(Map<String, Object> keys, boolean unique);
    }

    private MongoDatabase(String name, MongoClientAdapter client, String databaseName) {
        super(name, DatabaseType.MONGODB);
        this.client = client;
        this.databaseName = databaseName;
    }

    /**
     * Creates a MongoDB database instance.
     *
     * @param name the logical name
     * @param client the MongoDB client adapter
     * @param databaseName the database name
     * @return the database instance
     */
    public static MongoDatabase create(String name, MongoClientAdapter client, String databaseName) {
        return new MongoDatabase(name, client, databaseName);
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
        return client.ping();
    }

    @Override
    public List<String> listCollections() {
        return client.getDatabase(databaseName).listCollectionNames();
    }

    @Override
    public boolean collectionExists(String name) {
        return listCollections().contains(name);
    }

    @Override
    protected NoSqlCollection createCollectionInstance(String name) {
        return new MongoCollectionImpl(name, client.getDatabase(databaseName).getCollection(name));
    }

    @Override
    protected void doCreateCollection(String name) {
        client.getDatabase(databaseName).createCollection(name);
    }

    @Override
    protected boolean doDropCollection(String name) {
        try {
            client.getDatabase(databaseName).dropCollection(name);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Gets the underlying MongoDB client adapter.
     */
    public MongoClientAdapter getClient() {
        return client;
    }

    /**
     * MongoDB collection implementation.
     */
    private class MongoCollectionImpl extends AbstractNoSqlCollection {
        private final MongoCollectionAdapter adapter;

        MongoCollectionImpl(String name, MongoCollectionAdapter adapter) {
            super(name);
            this.adapter = adapter;
        }

        @Override
        public String insert(Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                String id = adapter.insertOne(document);
                recordQuery(start, true);
                return id;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "insert", e.getMessage(), e);
            }
        }

        @Override
        public List<String> insertMany(List<Map<String, Object>> documents) {
            long start = System.nanoTime();
            try {
                List<String> ids = adapter.insertMany(documents);
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
                Map<String, Object> result = adapter.findById(id);
                recordQuery(start, true);
                return result != null ? Optional.of(Document.of(result)) : Optional.empty();
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "findById", e.getMessage(), e);
            }
        }

        @Override
        public List<Document> find(Map<String, Object> query) {
            long start = System.nanoTime();
            try {
                List<Map<String, Object>> results = adapter.find(query);
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
                boolean result = adapter.updateById(id, updates);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "updateById", e.getMessage(), e);
            }
        }

        @Override
        public long update(Map<String, Object> query, Map<String, Object> updates) {
            long start = System.nanoTime();
            try {
                long result = adapter.updateMany(query, updates);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "update", e.getMessage(), e);
            }
        }

        @Override
        public boolean replaceById(String id, Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                boolean result = adapter.replaceById(id, document);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "replaceById", e.getMessage(), e);
            }
        }

        @Override
        public String upsert(Map<String, Object> query, Map<String, Object> document) {
            Optional<Document> existing = findOne(query);
            if (existing.isPresent()) {
                String id = existing.get().getId();
                replaceById(id, document);
                return id;
            } else {
                return insert(document);
            }
        }

        @Override
        public boolean deleteById(String id) {
            long start = System.nanoTime();
            try {
                boolean result = adapter.deleteById(id);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "deleteById", e.getMessage(), e);
            }
        }

        @Override
        public long delete(Map<String, Object> query) {
            long start = System.nanoTime();
            try {
                long result = adapter.deleteMany(query);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "delete", e.getMessage(), e);
            }
        }

        @Override
        public long count(Map<String, Object> query) {
            long start = System.nanoTime();
            try {
                long result = adapter.count(query);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "count", e.getMessage(), e);
            }
        }
    }
}
