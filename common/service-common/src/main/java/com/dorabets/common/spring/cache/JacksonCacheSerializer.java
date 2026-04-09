package com.dorabets.common.spring.cache;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.model.cache.CacheException;
import com.natsu.common.model.cache.CacheSerializer;

public class JacksonCacheSerializer<T> implements CacheSerializer<T> {

  private final ObjectMapper objectMapper;
  private final JavaType javaType;

  public JacksonCacheSerializer(ObjectMapper objectMapper, Class<T> type) {
    this.objectMapper = objectMapper;
    this.javaType = objectMapper.constructType(type);
  }

  public JacksonCacheSerializer(ObjectMapper objectMapper, TypeReference<T> typeReference) {
    this.objectMapper = objectMapper;
    this.javaType = objectMapper.getTypeFactory().constructType(typeReference);
  }

  @Override
  public byte[] serialize(T value) {
    try {
      return objectMapper.writeValueAsBytes(value);
    } catch (Exception e) {
      throw new CacheException("Failed to serialize cache value", e);
    }
  }

  @Override
  public T deserialize(byte[] data) {
    try {
      return objectMapper.readValue(data, javaType);
    } catch (Exception e) {
      throw new CacheException("Failed to deserialize cache value", e);
    }
  }
}
