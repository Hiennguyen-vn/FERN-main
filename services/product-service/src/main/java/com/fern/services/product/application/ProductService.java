package com.fern.services.product.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.web.QueryConventions;
import com.fern.events.product.ProductPriceChangedEvent;
import com.fern.events.product.ProductRecipeUpdatedEvent;
import com.fern.events.product.ProductRecipeUpdatedLineItem;
import com.fern.services.product.api.ProductDtos;
import com.fern.services.product.infrastructure.ProductRepository;
import java.time.Clock;
import java.time.LocalDate;
import org.springframework.stereotype.Service;

@Service
public class ProductService {

  private final ProductRepository productRepository;
  private final ProductPriceCacheService productPriceCacheService;
  private final TypedKafkaEventPublisher kafkaEventPublisher;
  private final Clock clock;

  public ProductService(
      ProductRepository productRepository,
      ProductPriceCacheService productPriceCacheService,
      TypedKafkaEventPublisher kafkaEventPublisher,
      Clock clock
  ) {
    this.productRepository = productRepository;
    this.productPriceCacheService = productPriceCacheService;
    this.kafkaEventPublisher = kafkaEventPublisher;
    this.clock = clock;
  }

  public PagedResult<ProductDtos.ProductView> listProducts(
      String status,
      String categoryCode,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return productRepository.listProducts(
        trimToNull(status),
        trimToNull(categoryCode),
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public ProductDtos.ProductView createProduct(ProductDtos.CreateProductRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    return productRepository.createProduct(request, context.userId());
  }

  public PagedResult<ProductDtos.ItemView> listItems(
      String status,
      String categoryCode,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    return productRepository.listItems(
        trimToNull(status),
        trimToNull(categoryCode),
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public ProductDtos.ItemView createItem(ProductDtos.CreateItemRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    return productRepository.createItem(request);
  }

  public PagedResult<ProductDtos.PriceView> listPrices(
      long outletId,
      Long productId,
      LocalDate onDate,
      String q,
      String sortBy,
      String sortDir,
      Integer limit,
      Integer offset
  ) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireOutletReadAccess(context, outletId);
    LocalDate businessDate = onDate == null ? LocalDate.now() : onDate;
    return productRepository.listPrices(
        outletId,
        productId,
        businessDate,
        QueryConventions.normalizeQuery(q),
        sortBy,
        sortDir,
        sanitizeLimit(limit),
        sanitizeOffset(offset)
    );
  }

  public ProductDtos.PriceView findPrice(long productId, long outletId, LocalDate onDate) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireOutletReadAccess(context, outletId);
    LocalDate businessDate = onDate == null ? LocalDate.now() : onDate;
    return productPriceCacheService.getOrLoad(
        productId,
        outletId,
        businessDate,
        () -> productRepository.findPrice(productId, outletId, businessDate)
            .orElseThrow(() -> ServiceException.notFound(
                "Price not found for product " + productId + " at outlet " + outletId
            ))
    );
  }

  public ProductDtos.PriceView upsertPrice(ProductDtos.UpsertPriceRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    ProductDtos.PriceView previous = productRepository.findPrice(
        request.productId(),
        request.outletId(),
        request.effectiveFrom()
    ).orElse(null);
    ProductDtos.PriceView saved = productRepository.upsertPrice(request, context.userId());
    productPriceCacheService.evict(saved.productId(), saved.outletId(), saved.effectiveFrom());
    kafkaEventPublisher.publish(
        "fern.product.product-price-changed",
        Long.toString(saved.productId()),
        "product.price.changed",
        new ProductPriceChangedEvent(
            saved.productId(),
            saved.outletId(),
            saved.currencyCode(),
            previous == null ? null : previous.priceValue(),
            saved.priceValue(),
            saved.effectiveFrom(),
            context.userId(),
            clock.instant()
        )
    );
    return saved;
  }

  public ProductDtos.RecipeView resolveRecipe(long productId, String version) {
    return productRepository.findRecipe(productId, version)
        .orElseThrow(() -> ServiceException.notFound("Recipe not found for product " + productId));
  }

  public ProductDtos.RecipeView upsertRecipe(long productId, ProductDtos.UpsertRecipeRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    ProductDtos.RecipeView recipe = productRepository.upsertRecipe(productId, request, context.userId());
    kafkaEventPublisher.publish(
        "fern.product.product-recipe-updated",
        Long.toString(recipe.productId()),
        "product.recipe.updated",
        new ProductRecipeUpdatedEvent(
            recipe.productId(),
            recipe.version(),
            recipe.status(),
            recipe.items().stream()
                .map(item -> new ProductRecipeUpdatedLineItem(item.itemId(), item.uomCode(), item.qty()))
                .toList(),
            clock.instant(),
            context.userId()
        )
    );
    return recipe;
  }

  private void requireCatalogMutationAccess(RequestUserContext context) {
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")
        || context.hasPermission("product.catalog.write")) {
      return;
    }
    context.requireUserId();
    throw ServiceException.forbidden("Catalog management permission is required");
  }

  private void requireOutletReadAccess(RequestUserContext context, long outletId) {
    if (context.internalService() || context.hasRole("admin") || context.hasRole("superadmin")) {
      return;
    }
    context.requireUserId();
    if (context.outletIds().contains(outletId)) {
      return;
    }
    throw ServiceException.forbidden("Catalog access denied for outlet " + outletId);
  }

  private int sanitizeLimit(Integer limit) {
    return QueryConventions.sanitizeLimit(limit, 50, 200);
  }

  private int sanitizeOffset(Integer offset) {
    return QueryConventions.sanitizeOffset(offset);
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
