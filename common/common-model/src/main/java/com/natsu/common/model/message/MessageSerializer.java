package com.natsu.common.model.message;

/**
 * Interface for serializing/deserializing message payloads.
 */
public interface MessageSerializer {

    /**
     * Serializes a payload to bytes.
     *
     * @param payload the payload to serialize
     * @param <T> the payload type
     * @return the serialized bytes
     */
    <T> byte[] serialize(T payload);

    /**
     * Deserializes bytes to a payload.
     *
     * @param data the bytes to deserialize
     * @param type the expected type
     * @param <T> the payload type
     * @return the deserialized payload
     */
    <T> T deserialize(byte[] data, Class<T> type);

    /**
     * Gets the content type for this serializer.
     *
     * @return the content type (e.g., "application/json")
     */
    default String getContentType() {
        return "application/octet-stream";
    }

    /**
     * Creates a JSON serializer using Jackson if available.
     *
     * @return a JSON serializer
     */
    static MessageSerializer json() {
        return new JsonMessageSerializer();
    }

    /**
     * Creates a Java serialization-based serializer.
     *
     * @return a Java serializer
     */
    static MessageSerializer java() {
        return new JavaMessageSerializer();
    }

    /**
     * Creates a string serializer for simple String payloads.
     *
     * @return a string serializer
     */
    static MessageSerializer string() {
        return new StringMessageSerializer();
    }

    /**
     * JSON serializer using Jackson.
     */
    class JsonMessageSerializer implements MessageSerializer {
        private final com.fasterxml.jackson.databind.ObjectMapper objectMapper;

        public JsonMessageSerializer() {
            this.objectMapper = new com.fasterxml.jackson.databind.ObjectMapper()
                    .findAndRegisterModules();
        }

        public JsonMessageSerializer(com.fasterxml.jackson.databind.ObjectMapper objectMapper) {
            this.objectMapper = objectMapper;
        }

        @Override
        public <T> byte[] serialize(T payload) {
            try {
                return objectMapper.writeValueAsBytes(payload);
            } catch (Exception e) {
                throw new MessageException("Failed to serialize payload", e);
            }
        }

        @Override
        public <T> T deserialize(byte[] data, Class<T> type) {
            try {
                return objectMapper.readValue(data, type);
            } catch (Exception e) {
                throw new MessageException("Failed to deserialize payload", e);
            }
        }

        @Override
        public String getContentType() {
            return "application/json";
        }
    }

    /**
     * Java object serialization.
     */
    class JavaMessageSerializer implements MessageSerializer {
        @Override
        @SuppressWarnings("unchecked")
        public <T> byte[] serialize(T payload) {
            try (var baos = new java.io.ByteArrayOutputStream();
                 var oos = new java.io.ObjectOutputStream(baos)) {
                oos.writeObject(payload);
                return baos.toByteArray();
            } catch (Exception e) {
                throw new MessageException("Failed to serialize payload", e);
            }
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> T deserialize(byte[] data, Class<T> type) {
            try (var bais = new java.io.ByteArrayInputStream(data);
                 var ois = new java.io.ObjectInputStream(bais)) {
                return (T) ois.readObject();
            } catch (Exception e) {
                throw new MessageException("Failed to deserialize payload", e);
            }
        }

        @Override
        public String getContentType() {
            return "application/x-java-serialized-object";
        }
    }

    /**
     * Simple string serializer.
     */
    class StringMessageSerializer implements MessageSerializer {
        private static final java.nio.charset.Charset UTF8 = java.nio.charset.StandardCharsets.UTF_8;

        @Override
        @SuppressWarnings("unchecked")
        public <T> byte[] serialize(T payload) {
            return String.valueOf(payload).getBytes(UTF8);
        }

        @Override
        @SuppressWarnings("unchecked")
        public <T> T deserialize(byte[] data, Class<T> type) {
            String str = new String(data, UTF8);
            if (type == String.class) {
                return (T) str;
            }
            throw new MessageException("StringSerializer only supports String type");
        }

        @Override
        public String getContentType() {
            return "text/plain";
        }
    }
}
