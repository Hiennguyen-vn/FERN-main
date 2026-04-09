package com.natsu.common.model.database.nosql;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Interface for a NoSQL collection/table.
 */
public interface NoSqlCollection {

    /**
     * Gets the collection name.
     *
     * @return the name
     */
    String getName();

    /**
     * Inserts a document.
     *
     * @param document the document to insert
     * @return the generated ID
     */
    String insert(Map<String, Object> document);

    /**
     * Inserts a document from an object.
     *
     * @param document the document object
     * @param <T> the document type
     * @return the generated ID
     */
    <T> String insert(T document);

    /**
     * Inserts multiple documents.
     *
     * @param documents the documents to insert
     * @return list of generated IDs
     */
    List<String> insertMany(List<Map<String, Object>> documents);

    /**
     * Finds a document by ID.
     *
     * @param id the document ID
     * @return the document, or empty
     */
    Optional<Document> findById(String id);

    /**
     * Finds a document by ID and maps to type.
     *
     * @param id the document ID
     * @param type the expected type
     * @param <T> the type
     * @return the document, or empty
     */
    <T> Optional<T> findById(String id, Class<T> type);

    /**
     * Finds documents matching a query.
     *
     * @param query the query (field -> value)
     * @return list of matching documents
     */
    List<Document> find(Map<String, Object> query);

    /**
     * Finds documents matching a query and maps to type.
     *
     * @param query the query
     * @param type the expected type
     * @param <T> the type
     * @return list of matching documents
     */
    <T> List<T> find(Map<String, Object> query, Class<T> type);

    /**
     * Finds all documents in the collection.
     *
     * @return list of all documents
     */
    List<Document> findAll();

    /**
     * Finds the first document matching a query.
     *
     * @param query the query
     * @return the first matching document, or empty
     */
    Optional<Document> findOne(Map<String, Object> query);

    /**
     * Updates a document by ID.
     *
     * @param id the document ID
     * @param updates the updates to apply
     * @return true if updated
     */
    boolean updateById(String id, Map<String, Object> updates);

    /**
     * Updates documents matching a query.
     *
     * @param query the query
     * @param updates the updates to apply
     * @return number of updated documents
     */
    long update(Map<String, Object> query, Map<String, Object> updates);

    /**
     * Replaces a document by ID.
     *
     * @param id the document ID
     * @param document the new document
     * @return true if replaced
     */
    boolean replaceById(String id, Map<String, Object> document);

    /**
     * Upserts a document (insert or update).
     *
     * @param query the query to match
     * @param document the document to upsert
     * @return the document ID
     */
    String upsert(Map<String, Object> query, Map<String, Object> document);

    /**
     * Deletes a document by ID.
     *
     * @param id the document ID
     * @return true if deleted
     */
    boolean deleteById(String id);

    /**
     * Deletes documents matching a query.
     *
     * @param query the query
     * @return number of deleted documents
     */
    long delete(Map<String, Object> query);

    /**
     * Counts documents matching a query.
     *
     * @param query the query (empty for all)
     * @return the count
     */
    long count(Map<String, Object> query);

    /**
     * Counts all documents.
     *
     * @return the count
     */
    default long count() {
        return count(Map.of());
    }

    /**
     * Checks if a document exists.
     *
     * @param id the document ID
     * @return true if exists
     */
    default boolean exists(String id) {
        return findById(id).isPresent();
    }

    /**
     * Creates a query builder.
     *
     * @return the query builder
     */
    NoSqlQueryBuilder query();

    // Async operations

    default CompletableFuture<String> insertAsync(Map<String, Object> document) {
        return CompletableFuture.supplyAsync(() -> insert(document));
    }

    default CompletableFuture<Optional<Document>> findByIdAsync(String id) {
        return CompletableFuture.supplyAsync(() -> findById(id));
    }

    default CompletableFuture<List<Document>> findAsync(Map<String, Object> query) {
        return CompletableFuture.supplyAsync(() -> find(query));
    }

    default CompletableFuture<Boolean> deleteByIdAsync(String id) {
        return CompletableFuture.supplyAsync(() -> deleteById(id));
    }
}
