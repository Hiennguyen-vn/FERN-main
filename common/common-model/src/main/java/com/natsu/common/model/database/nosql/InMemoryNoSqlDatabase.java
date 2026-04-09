package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseType;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory NoSQL database implementation for testing and development.
 */
public class InMemoryNoSqlDatabase extends AbstractNoSqlDatabase {

    private final Map<String, Map<String, Map<String, Object>>> data = new ConcurrentHashMap<>();

    private InMemoryNoSqlDatabase(String name) {
        super(name, DatabaseType.MONGODB); // Generic NoSQL type
    }

    /**
     * Creates an in-memory NoSQL database.
     *
     * @param name the database name
     * @return the database instance
     */
    public static InMemoryNoSqlDatabase create(String name) {
        return new InMemoryNoSqlDatabase(name);
    }

    @Override
    public void connect() {
        connected = true;
    }

    @Override
    public void disconnect() {
        connected = false;
    }

    @Override
    public boolean testConnection() {
        return connected;
    }

    @Override
    public List<String> listCollections() {
        return new ArrayList<>(data.keySet());
    }

    @Override
    public boolean collectionExists(String name) {
        return data.containsKey(name);
    }

    @Override
    protected NoSqlCollection createCollectionInstance(String name) {
        return new InMemoryCollection(name);
    }

    @Override
    protected void doCreateCollection(String name) {
        data.putIfAbsent(name, new ConcurrentHashMap<>());
    }

    @Override
    protected boolean doDropCollection(String name) {
        return data.remove(name) != null;
    }

    /**
     * Clears all data from all collections.
     */
    public void clear() {
        data.clear();
    }

    private Map<String, Map<String, Object>> getCollectionData(String name) {
        return data.computeIfAbsent(name, k -> new ConcurrentHashMap<>());
    }

    /**
     * In-memory collection implementation.
     */
    private class InMemoryCollection extends AbstractNoSqlCollection {

        InMemoryCollection(String name) {
            super(name);
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
                getCollectionData(collectionName).put(id, new HashMap<>(document));
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
                Map<String, Object> doc = getCollectionData(collectionName).get(id);
                recordQuery(start, true);
                if (doc != null) {
                    return Optional.of(Document.of(new HashMap<>(doc)));
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
                List<Document> results = new ArrayList<>();
                for (Map<String, Object> doc : getCollectionData(collectionName).values()) {
                    if (matchesQuery(doc, query)) {
                        results.add(Document.of(new HashMap<>(doc)));
                    }
                }
                recordQuery(start, true);
                return results;
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
                Map<String, Object> doc = getCollectionData(collectionName).get(id);
                if (doc == null) {
                    recordQuery(start, false);
                    return false;
                }
                doc.putAll(updates);
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
                Map<String, Map<String, Object>> collection = getCollectionData(collectionName);
                if (!collection.containsKey(id)) {
                    recordQuery(start, false);
                    return false;
                }
                document = new HashMap<>(document);
                document.put("id", id);
                collection.put(id, document);
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
                String id = existing.get().getString("id");
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
                Map<String, Object> removed = getCollectionData(collectionName).remove(id);
                recordQuery(start, true);
                return removed != null;
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
                return getCollectionData(collectionName).size();
            }
            return find(query).size();
        }

        private boolean matchesQuery(Map<String, Object> doc, Map<String, Object> query) {
            if (query.isEmpty()) {
                return true;
            }
            for (Map.Entry<String, Object> entry : query.entrySet()) {
                Object docValue = doc.get(entry.getKey());
                if (!Objects.equals(entry.getValue(), docValue)) {
                    return false;
                }
            }
            return true;
        }
    }
}
