package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseType;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Firebase Realtime Database / Firestore implementation.
 * Uses a client adapter pattern to work with Firebase SDK.
 */
public class FirebaseDatabase extends AbstractNoSqlDatabase {

    private final FirebaseClientAdapter client;

    /**
     * Interface for Firebase client adapters.
     */
    public interface FirebaseClientAdapter {
        /**
         * Initializes the Firebase connection.
         */
        void initialize();

        /**
         * Closes the Firebase connection.
         */
        void close();

        /**
         * Checks if initialized.
         */
        boolean isInitialized();

        /**
         * Gets a collection reference.
         */
        FirebaseCollectionAdapter collection(String path);

        /**
         * Lists top-level collections.
         */
        List<String> listCollections();

        /**
         * Deletes a collection.
         */
        void deleteCollection(String name);
    }

    /**
     * Adapter for a Firebase collection.
     */
    public interface FirebaseCollectionAdapter {
        /**
         * Adds a document with auto-generated ID.
         */
        String add(Map<String, Object> document);

        /**
         * Sets a document with specific ID.
         */
        void set(String id, Map<String, Object> document);

        /**
         * Sets a document with merge option.
         */
        void set(String id, Map<String, Object> document, boolean merge);

        /**
         * Gets a document by ID.
         */
        Map<String, Object> get(String id);

        /**
         * Gets all documents.
         */
        List<Map<String, Object>> getAll();

        /**
         * Queries documents.
         */
        List<Map<String, Object>> query(String field, String operator, Object value);

        /**
         * Queries with multiple conditions.
         */
        List<Map<String, Object>> query(List<QueryCondition> conditions);

        /**
         * Updates a document.
         */
        void update(String id, Map<String, Object> updates);

        /**
         * Deletes a document.
         */
        void delete(String id);

        /**
         * Counts documents (may require a query).
         */
        long count();

        /**
         * Listens for real-time updates.
         */
        void addListener(DocumentListener listener);

        /**
         * Removes a listener.
         */
        void removeListener(DocumentListener listener);
    }

    /**
     * Query condition for Firebase.
     */
    public record QueryCondition(String field, String operator, Object value) {
        public static QueryCondition eq(String field, Object value) {
            return new QueryCondition(field, "==", value);
        }
        public static QueryCondition lt(String field, Object value) {
            return new QueryCondition(field, "<", value);
        }
        public static QueryCondition lte(String field, Object value) {
            return new QueryCondition(field, "<=", value);
        }
        public static QueryCondition gt(String field, Object value) {
            return new QueryCondition(field, ">", value);
        }
        public static QueryCondition gte(String field, Object value) {
            return new QueryCondition(field, ">=", value);
        }
    }

    /**
     * Listener for document changes.
     */
    public interface DocumentListener {
        void onAdded(String id, Map<String, Object> document);
        void onModified(String id, Map<String, Object> document);
        void onRemoved(String id);
        default void onError(Exception e) {}
    }

    private FirebaseDatabase(String name, FirebaseClientAdapter client) {
        super(name, DatabaseType.FIREBASE);
        this.client = client;
    }

    /**
     * Creates a Firebase database instance.
     *
     * @param name the logical name
     * @param client the Firebase client adapter
     * @return the database instance
     */
    public static FirebaseDatabase create(String name, FirebaseClientAdapter client) {
        return new FirebaseDatabase(name, client);
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
        return client.listCollections();
    }

    @Override
    public boolean collectionExists(String name) {
        return listCollections().contains(name);
    }

    @Override
    protected NoSqlCollection createCollectionInstance(String name) {
        return new FirebaseCollectionImpl(name, client.collection(name));
    }

    @Override
    protected void doCreateCollection(String name) {
        // Firebase creates collections automatically when documents are added
    }

    @Override
    protected boolean doDropCollection(String name) {
        try {
            client.deleteCollection(name);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    /**
     * Gets the underlying Firebase client adapter.
     */
    public FirebaseClientAdapter getClient() {
        return client;
    }

    /**
     * Firebase collection implementation.
     */
    private class FirebaseCollectionImpl extends AbstractNoSqlCollection {
        private final FirebaseCollectionAdapter adapter;

        FirebaseCollectionImpl(String name, FirebaseCollectionAdapter adapter) {
            super(name);
            this.adapter = adapter;
        }

        @Override
        public String insert(Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                String id = adapter.add(document);
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
                Map<String, Object> result = adapter.get(id);
                recordQuery(start, true);
                if (result != null) {
                    Document doc = Document.of(result);
                    doc.setId(id);
                    return Optional.of(doc);
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
                    results = adapter.getAll();
                } else {
                    List<QueryCondition> conditions = new ArrayList<>();
                    for (Map.Entry<String, Object> entry : query.entrySet()) {
                        conditions.add(QueryCondition.eq(entry.getKey(), entry.getValue()));
                    }
                    results = adapter.query(conditions);
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
                adapter.update(id, updates);
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
                updateById(doc.getId(), updates);
            }
            return docs.size();
        }

        @Override
        public boolean replaceById(String id, Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                adapter.set(id, document);
                recordQuery(start, true);
                return true;
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
                adapter.set(id, document, true);
                return id;
            } else {
                return insert(document);
            }
        }

        @Override
        public boolean deleteById(String id) {
            long start = System.nanoTime();
            try {
                adapter.delete(id);
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
                deleteById(doc.getId());
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

        /**
         * Adds a real-time listener.
         */
        public void addListener(DocumentListener listener) {
            adapter.addListener(listener);
        }

        /**
         * Removes a real-time listener.
         */
        public void removeListener(DocumentListener listener) {
            adapter.removeListener(listener);
        }
    }
}
