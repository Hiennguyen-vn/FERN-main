package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.DatabaseException;
import com.natsu.common.model.database.DatabaseType;

import java.util.*;

/**
 * Redis database implementation for document-style storage.
 * Uses a client adapter pattern to work with any Redis client (Jedis, Lettuce, etc.).
 */
public class RedisDatabase extends AbstractNoSqlDatabase {

    private final RedisClientAdapter client;

    /**
     * Interface for Redis client adapters.
     */
    public interface RedisClientAdapter {
        /**
         * Connects to Redis.
         */
        void connect();

        /**
         * Disconnects from Redis.
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

        // String commands
        String get(String key);
        void set(String key, String value);
        void set(String key, String value, long ttlSeconds);
        boolean del(String key);
        boolean exists(String key);
        List<String> keys(String pattern);

        // Hash commands
        Map<String, String> hgetall(String key);
        String hget(String key, String field);
        void hset(String key, String field, String value);
        void hmset(String key, Map<String, String> hash);
        boolean hdel(String key, String... fields);
        boolean hexists(String key, String field);
        Set<String> hkeys(String key);

        // Set commands
        void sadd(String key, String... members);
        boolean sismember(String key, String member);
        Set<String> smembers(String key);
        long scard(String key);
        boolean srem(String key, String... members);

        // Sorted set commands
        void zadd(String key, double score, String member);
        Set<String> zrange(String key, long start, long end);
        Set<String> zrangeByScore(String key, double min, double max);
        Double zscore(String key, String member);
        long zcard(String key);
        boolean zrem(String key, String... members);

        // Key commands
        long ttl(String key);
        boolean expire(String key, long seconds);

        // Transaction commands
        void multi();
        List<Object> exec();
        void discard();
    }

    private final String keyPrefix;
    private final DocumentSerializer documentSerializer;

    private RedisDatabase(String name, RedisClientAdapter client, String keyPrefix, DocumentSerializer serializer) {
        super(name, DatabaseType.REDIS, serializer);
        this.client = client;
        this.keyPrefix = keyPrefix != null ? keyPrefix : "";
        this.documentSerializer = serializer;
    }

    /**
     * Creates a Redis database instance.
     *
     * @param name the logical name
     * @param client the Redis client adapter
     * @return the database instance
     */
    public static RedisDatabase create(String name, RedisClientAdapter client) {
        return new RedisDatabase(name, client, name + ":", DocumentSerializer.json());
    }

    /**
     * Creates a Redis database instance with custom prefix.
     *
     * @param name the logical name
     * @param client the Redis client adapter
     * @param keyPrefix the key prefix for all operations
     * @return the database instance
     */
    public static RedisDatabase create(String name, RedisClientAdapter client, String keyPrefix) {
        return new RedisDatabase(name, client, keyPrefix, DocumentSerializer.json());
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
        // In Redis, we use key patterns to simulate collections
        Set<String> collectionKeys = new HashSet<>();
        List<String> keys = client.keys(keyPrefix + "*:*");
        for (String key : keys) {
            String withoutPrefix = key.substring(keyPrefix.length());
            int colonIndex = withoutPrefix.indexOf(':');
            if (colonIndex > 0) {
                collectionKeys.add(withoutPrefix.substring(0, colonIndex));
            }
        }
        return new ArrayList<>(collectionKeys);
    }

    @Override
    public boolean collectionExists(String name) {
        List<String> keys = client.keys(getCollectionPattern(name));
        return !keys.isEmpty();
    }

    @Override
    protected NoSqlCollection createCollectionInstance(String name) {
        return new RedisCollectionImpl(name);
    }

    @Override
    protected void doCreateCollection(String name) {
        // Redis doesn't require explicit collection creation
        // Collections are created automatically when documents are added
    }

    @Override
    protected boolean doDropCollection(String name) {
        List<String> keys = client.keys(getCollectionPattern(name));
        for (String key : keys) {
            client.del(key);
        }
        return true;
    }

    private String getCollectionPattern(String collection) {
        return keyPrefix + collection + ":*";
    }

    private String getDocumentKey(String collection, String id) {
        return keyPrefix + collection + ":" + id;
    }

    /**
     * Gets the underlying Redis client adapter.
     */
    public RedisClientAdapter getClient() {
        return client;
    }

    /**
     * Redis collection implementation using hash operations.
     */
    private class RedisCollectionImpl extends AbstractNoSqlCollection {

        RedisCollectionImpl(String name) {
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

                String key = getDocumentKey(collectionName, id);
                Map<String, String> hash = serializeToHash(document);
                client.hmset(key, hash);
                
                // Track collection members
                client.sadd(keyPrefix + collectionName + ":_ids", id);
                
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
                String key = getDocumentKey(collectionName, id);
                Map<String, String> hash = client.hgetall(key);
                recordQuery(start, true);
                if (hash != null && !hash.isEmpty()) {
                    return Optional.of(Document.of(deserializeFromHash(hash)));
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
                Set<String> ids = client.smembers(keyPrefix + collectionName + ":_ids");
                
                for (String id : ids) {
                    Optional<Document> doc = findById(id);
                    if (doc.isPresent() && matchesQuery(doc.get(), query)) {
                        results.add(doc.get());
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
                String key = getDocumentKey(collectionName, id);
                if (!client.exists(key)) {
                    recordQuery(start, false);
                    return false;
                }
                
                Map<String, String> hash = serializeToHash(updates);
                for (Map.Entry<String, String> entry : hash.entrySet()) {
                    client.hset(key, entry.getKey(), entry.getValue());
                }
                
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
            long count = 0;
            for (Document doc : docs) {
                if (updateById(doc.getString("id"), updates)) {
                    count++;
                }
            }
            return count;
        }

        @Override
        public boolean replaceById(String id, Map<String, Object> document) {
            long start = System.nanoTime();
            try {
                String key = getDocumentKey(collectionName, id);
                client.del(key);
                
                document = new HashMap<>(document);
                document.put("id", id);
                
                Map<String, String> hash = serializeToHash(document);
                client.hmset(key, hash);
                
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
                String key = getDocumentKey(collectionName, id);
                boolean result = client.del(key);
                client.srem(keyPrefix + collectionName + ":_ids", id);
                recordQuery(start, true);
                return result;
            } catch (Exception e) {
                recordQuery(start, false);
                throw new DatabaseException(name, "deleteById", e.getMessage(), e);
            }
        }

        @Override
        public long delete(Map<String, Object> query) {
            List<Document> docs = find(query);
            long count = 0;
            for (Document doc : docs) {
                if (deleteById(doc.getString("id"))) {
                    count++;
                }
            }
            return count;
        }

        @Override
        public long count(Map<String, Object> query) {
            if (query.isEmpty()) {
                return client.scard(keyPrefix + collectionName + ":_ids");
            }
            return find(query).size();
        }

        private Map<String, String> serializeToHash(Map<String, Object> document) {
            Map<String, String> hash = new HashMap<>();
            for (Map.Entry<String, Object> entry : document.entrySet()) {
                Object value = entry.getValue();
                if (value != null) {
                    if (value instanceof String) {
                        hash.put(entry.getKey(), (String) value);
                    } else {
                        // Serialize complex types to JSON
                        hash.put(entry.getKey(), String.valueOf(value));
                    }
                }
            }
            return hash;
        }

        private Map<String, Object> deserializeFromHash(Map<String, String> hash) {
            Map<String, Object> document = new HashMap<>();
            for (Map.Entry<String, String> entry : hash.entrySet()) {
                document.put(entry.getKey(), entry.getValue());
            }
            return document;
        }

        private boolean matchesQuery(Document doc, Map<String, Object> query) {
            if (query.isEmpty()) {
                return true;
            }
            for (Map.Entry<String, Object> entry : query.entrySet()) {
                Object docValue = doc.get(entry.getKey());
                if (!Objects.equals(String.valueOf(entry.getValue()), String.valueOf(docValue))) {
                    return false;
                }
            }
            return true;
        }
    }
}
