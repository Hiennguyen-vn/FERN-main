package com.fern.services.product.application;

import com.dorabets.common.spring.cache.JacksonCacheSerializer;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.natsu.common.model.cache.RedisClientAdapter;
import com.natsu.common.model.cache.TieredCache;
import com.fern.services.product.api.ProductDtos;
import java.time.Duration;
import java.time.LocalDate;
import org.springframework.stereotype.Service;

@Service
public class ProductPriceCacheService {

  private final TieredCache<ProductDtos.PriceView> priceCache;

  public ProductPriceCacheService(
      RedisClientAdapter redisClientAdapter,
      ObjectMapper objectMapper
  ) {
    this.priceCache = TieredCache.<ProductDtos.PriceView>builder("fern-product-prices")
        .localMaxSize(4_000)
        .localTtl(Duration.ofMinutes(5))
        .redisTtl(Duration.ofMinutes(20))
        .redisClient(redisClientAdapter)
        .serializer(new JacksonCacheSerializer<>(objectMapper, new TypeReference<ProductDtos.PriceView>() { }))
        .build();
  }

  public ProductDtos.PriceView getOrLoad(
      long productId,
      long outletId,
      LocalDate businessDate,
      java.util.function.Supplier<ProductDtos.PriceView> loader
  ) {
    return priceCache.getOrCompute(cacheKey(productId, outletId, businessDate), loader, Duration.ofMinutes(20));
  }

  public void evict(long productId, long outletId, LocalDate effectiveFrom) {
    priceCache.remove(cacheKey(productId, outletId, effectiveFrom));
  }

  private static String cacheKey(long productId, long outletId, LocalDate businessDate) {
    return productId + ":" + outletId + ":" + businessDate;
  }
}
