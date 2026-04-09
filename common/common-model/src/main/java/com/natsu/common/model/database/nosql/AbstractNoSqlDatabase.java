package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseStats;
import com.natsu.common.model.database.DatabaseType;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Abstract base implementation for NoSQL databases.
 */
public abstract class AbstractNoSqlDatabase implements NoSqlDatabase {

    protected final String name;
    protected final DatabaseType type;
    protected final DatabaseStats stats;
    protected final DocumentSerializer serializer;
    protected final Map<String, NoSqlCollection> collections = new ConcurrentHashMap<>();
    protected volatile boolean connected = false;

    protected AbstractNoSqlDatabase(String name, DatabaseType type) {
        this(name, type, DocumentSerializer.json());
    }

    protected AbstractNoSqlDatabase(String name, DatabaseType type, DocumentSerializer serializer) {
        this.name = name;
        this.type = type;
        this.serializer = serializer;
        this.stats = new DatabaseStats(name);
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public DatabaseType getType() {
        return type;
    }

    @Override
    public boolean isConnected() {
        return connected;
    }

    @Override
    public DatabaseStats getStats() {
        return stats;
    }

    @Override
    public NoSqlCollection collection(String name) {
        return collections.computeIfAbsent(name, this::createCollectionInstance);
    }

    @Override
    public NoSqlCollection createCollection(String name) {
        if (!collectionExists(name)) {
            doCreateCollection(name);
        }
        return collection(name);
    }

    @Override
    public boolean dropCollection(String name) {
        collections.remove(name);
        return doDropCollection(name);
    }

    protected abstract NoSqlCollection createCollectionInstance(String name);
    protected abstract void doCreateCollection(String name);
    protected abstract boolean doDropCollection(String name);

    /**
     * Base implementation for NoSQL collections.
     */
    protected abstract class AbstractNoSqlCollection implements NoSqlCollection {
        protected final String collectionName;

        protected AbstractNoSqlCollection(String collectionName) {
            this.collectionName = collectionName;
        }

        @Override
        public String getName() {
            return collectionName;
        }

        @Override
        public <T> String insert(T document) {
            Document doc = serializer.serialize(document);
            return insert(doc.toMap());
        }

        @Override
        public <T> Optional<T> findById(String id, Class<T> type) {
            return findById(id).map(doc -> serializer.deserialize(doc, type));
        }

        @Override
        public <T> List<T> find(Map<String, Object> query, Class<T> type) {
            List<Document> docs = find(query);
            List<T> result = new ArrayList<>();
            for (Document doc : docs) {
                result.add(serializer.deserialize(doc, type));
            }
            return result;
        }

        @Override
        public Optional<Document> findOne(Map<String, Object> query) {
            List<Document> results = find(query);
            return results.isEmpty() ? Optional.empty() : Optional.of(results.get(0));
        }

        @Override
        public NoSqlQueryBuilder query() {
            return new NoSqlQueryBuilder(this);
        }

        protected void recordQuery(long startNanos, boolean success) {
            stats.recordQuery(System.nanoTime() - startNanos, success);
        }
    }
}
