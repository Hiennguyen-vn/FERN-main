package com.fern.services.org.application;

import com.dorabets.common.spring.cache.JacksonCacheSerializer;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.model.cache.RedisClientAdapter;
import com.natsu.common.model.cache.TieredCache;
import java.time.Duration;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class OrgHierarchyCacheService {

  private static final String LEGACY_HIERARCHY_KEY = "full";

  private final TieredCache<CachedHierarchy> hierarchyCache;

  public OrgHierarchyCacheService(
      RedisClientAdapter redisClientAdapter,
      ObjectMapper objectMapper
  ) {
    this.hierarchyCache = TieredCache.<CachedHierarchy>builder("fern-org-hierarchy")
        .localMaxSize(64)
        .localTtl(Duration.ofMinutes(15))
        .redisTtl(Duration.ofHours(6))
        .redisClient(redisClientAdapter)
        .serializer(new JacksonCacheSerializer<>(objectMapper, new TypeReference<CachedHierarchy>() { }))
        .build();
  }

  public CachedHierarchy getOrLoad(String cacheKey, java.util.function.Supplier<CachedHierarchy> loader) {
    return hierarchyCache.getOrCompute(cacheKey, loader, Duration.ofHours(6));
  }

  public CachedHierarchy getOrLoad(java.util.function.Supplier<CachedHierarchy> loader) {
    return getOrLoad(LEGACY_HIERARCHY_KEY, loader);
  }

  public void evict() {
    hierarchyCache.remove(LEGACY_HIERARCHY_KEY);
  }

  public record CachedHierarchy(
      List<com.fern.services.org.api.OrgDtos.RegionView> regions,
      List<com.fern.services.org.api.OrgDtos.OutletView> outlets
  ) {
  }
}
