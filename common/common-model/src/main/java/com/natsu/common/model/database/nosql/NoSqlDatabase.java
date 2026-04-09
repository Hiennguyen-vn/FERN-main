package com.natsu.common.model.database.nosql;

import com.natsu.common.model.database.Database;

import java.util.List;

/**
 * Interface for NoSQL document databases.
 * Supports document-based storage like MongoDB, Firebase, DynamoDB.
 */
public interface NoSqlDatabase extends Database {

    /**
     * Gets a collection/table.
     *
     * @param name the collection name
     * @return the collection
     */
    NoSqlCollection collection(String name);

    /**
     * Creates a collection if it doesn't exist.
     *
     * @param name the collection name
     * @return the collection
     */
    NoSqlCollection createCollection(String name);

    /**
     * Drops a collection.
     *
     * @param name the collection name
     * @return true if dropped
     */
    boolean dropCollection(String name);

    /**
     * Lists all collection names.
     *
     * @return list of collection names
     */
    List<String> listCollections();

    /**
     * Checks if a collection exists.
     *
     * @param name the collection name
     * @return true if exists
     */
    boolean collectionExists(String name);
}
