package com.natsu.common.model.cache;

/**
 * Interface for serializing and deserializing cache values.
 *
 * <p>Implementations can use JSON, Protocol Buffers, Kryo, or other formats.
 *
 * <p>Example JSON implementation:
 * <pre>
 * public class JsonCacheSerializer&lt;T&gt; implements CacheSerializer&lt;T&gt; {
 *     private final ObjectMapper mapper;
 *     private final Class&lt;T&gt; type;
 *
 *     public byte[] serialize(T value) {
 *         return mapper.writeValueAsBytes(value);
 *     }
 *
 *     public T deserialize(byte[] data) {
 *         return mapper.readValue(data, type);
 *     }
 * }
 * </pre>
 *
 * @param <T> the type to serialize
 */
public interface CacheSerializer<T> {

    /**
     * Serializes a value to bytes.
     *
     * @param value the value to serialize
     * @return the serialized bytes
     * @throws CacheException if serialization fails
     */
    byte[] serialize(T value);

    /**
     * Deserializes bytes to a value.
     *
     * @param data the bytes to deserialize
     * @return the deserialized value
     * @throws CacheException if deserialization fails
     */
    T deserialize(byte[] data);

    /**
     * Creates a String serializer (UTF-8 encoding).
     *
     * @return a String serializer
     */
    static CacheSerializer<String> string() {
        return new StringSerializer();
    }

    /**
     * Creates a byte array serializer (identity).
     *
     * @return a byte array serializer
     */
    static CacheSerializer<byte[]> bytes() {
        return new ByteArraySerializer();
    }

    /**
     * Creates a Java serialization serializer.
     * Note: Requires objects to implement Serializable.
     *
     * @param <T> the type
     * @return a Java serialization serializer
     */
    static <T> CacheSerializer<T> java() {
        return new JavaSerializer<>();
    }

    /**
     * String serializer using UTF-8 encoding.
     */
    class StringSerializer implements CacheSerializer<String> {
        private static final java.nio.charset.Charset UTF8 = java.nio.charset.StandardCharsets.UTF_8;

        @Override
        public byte[] serialize(String value) {
            if (value == null) {
                return null;
            }
            return value.getBytes(UTF8);
        }

        @Override
        public String deserialize(byte[] data) {
            if (data == null) {
                return null;
            }
            return new String(data, UTF8);
        }
    }

    /**
     * Identity serializer for byte arrays.
     */
    class ByteArraySerializer implements CacheSerializer<byte[]> {
        @Override
        public byte[] serialize(byte[] value) {
            return value;
        }

        @Override
        public byte[] deserialize(byte[] data) {
            return data;
        }
    }

    /**
     * Java serialization serializer.
     *
     * @param <T> the type (must implement Serializable)
     */
    class JavaSerializer<T> implements CacheSerializer<T> {
        @Override
        public byte[] serialize(T value) {
            if (value == null) {
                return null;
            }
            try (java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
                 java.io.ObjectOutputStream oos = new java.io.ObjectOutputStream(baos)) {
                oos.writeObject(value);
                return baos.toByteArray();
            } catch (java.io.IOException e) {
                throw new CacheException("Failed to serialize value", e);
            }
        }

        @Override
        @SuppressWarnings("unchecked")
        public T deserialize(byte[] data) {
            if (data == null) {
                return null;
            }
            try (java.io.ByteArrayInputStream bais = new java.io.ByteArrayInputStream(data);
                 java.io.ObjectInputStream ois = new java.io.ObjectInputStream(bais)) {
                return (T) ois.readObject();
            } catch (java.io.IOException | ClassNotFoundException e) {
                throw new CacheException("Failed to deserialize value", e);
            }
        }
    }
}
