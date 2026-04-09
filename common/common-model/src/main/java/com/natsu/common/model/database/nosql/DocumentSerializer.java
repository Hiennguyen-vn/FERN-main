package com.natsu.common.model.database.nosql;

/**
 * Interface for serializing objects to/from documents.
 */
public interface DocumentSerializer {

    /**
     * Serializes an object to a document.
     *
     * @param object the object to serialize
     * @param <T> the object type
     * @return the document
     */
    <T> Document serialize(T object);

    /**
     * Deserializes a document to an object.
     *
     * @param document the document
     * @param type the target type
     * @param <T> the object type
     * @return the object
     */
    <T> T deserialize(Document document, Class<T> type);

    /**
     * Creates a JSON-based serializer using Jackson.
     *
     * @return the serializer
     */
    static DocumentSerializer json() {
        return new JacksonDocumentSerializer();
    }

    /**
     * Creates a simple reflection-based serializer.
     *
     * @return the serializer
     */
    static DocumentSerializer reflection() {
        return new ReflectionDocumentSerializer();
    }
}

/**
 * Jackson-based document serializer.
 */
class JacksonDocumentSerializer implements DocumentSerializer {

    private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

    JacksonDocumentSerializer() {
        this.objectMapper = new com.fasterxml.jackson.databind.ObjectMapper()
                .findAndRegisterModules();
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> Document serialize(T object) {
        java.util.Map<String, Object> map = objectMapper.convertValue(object, java.util.Map.class);
        return Document.of(map);
    }

    @Override
    public <T> T deserialize(Document document, Class<T> type) {
        return objectMapper.convertValue(document.toMap(), type);
    }
}

/**
 * Simple reflection-based document serializer.
 */
class ReflectionDocumentSerializer implements DocumentSerializer {

    @Override
    public <T> Document serialize(T object) {
        Document doc = Document.empty();
        
        for (java.lang.reflect.Field field : object.getClass().getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isTransient(field.getModifiers()) ||
                java.lang.reflect.Modifier.isStatic(field.getModifiers())) {
                continue;
            }
            
            field.setAccessible(true);
            try {
                Object value = field.get(object);
                if (value != null) {
                    doc.put(field.getName(), value);
                }
            } catch (IllegalAccessException e) {
                // Skip inaccessible fields
            }
        }
        
        return doc;
    }

    @Override
    public <T> T deserialize(Document document, Class<T> type) {
        try {
            T instance = type.getDeclaredConstructor().newInstance();
            
            for (java.lang.reflect.Field field : type.getDeclaredFields()) {
                if (java.lang.reflect.Modifier.isTransient(field.getModifiers()) ||
                    java.lang.reflect.Modifier.isStatic(field.getModifiers())) {
                    continue;
                }
                
                field.setAccessible(true);
                Object value = document.get(field.getName());
                if (value != null) {
                    field.set(instance, value);
                }
            }
            
            return instance;
        } catch (Exception e) {
            throw new RuntimeException("Failed to deserialize document to " + type.getName(), e);
        }
    }
}
