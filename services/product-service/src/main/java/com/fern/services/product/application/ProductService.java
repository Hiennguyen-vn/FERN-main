package com.fern.services.product.application;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
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
import com.fern.services.product.infrastructure.PublishRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ProductService {

  private final ProductRepository productRepository;
  private final ProductPriceCacheService productPriceCacheService;
  private final TypedKafkaEventPublisher kafkaEventPublisher;
  private final AuthorizationPolicyService authorizationPolicyService;
  private final PublishRepository publishRepository;
  private final Clock clock;

  public ProductService(
      ProductRepository productRepository,
      ProductPriceCacheService productPriceCacheService,
      TypedKafkaEventPublisher kafkaEventPublisher,
      AuthorizationPolicyService authorizationPolicyService,
      PublishRepository publishRepository,
      Clock clock
  ) {
    this.productRepository = productRepository;
    this.productPriceCacheService = productPriceCacheService;
    this.kafkaEventPublisher = kafkaEventPublisher;
    this.authorizationPolicyService = authorizationPolicyService;
    this.publishRepository = publishRepository;
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
    ProductDtos.ProductView created = productRepository.createProduct(request, context.userId());
    audit("product", created.id(), "create", null, null, created.name(), "corporate", null);
    return created;
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
    ProductDtos.ItemView created = productRepository.createItem(request);
    audit("item", created.id(), "create", null, null, created.name(), "corporate", null);
    return created;
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
    audit("price", saved.productId(), previous == null ? "create" : "update", "priceValue",
        previous == null ? null : previous.priceValue().toPlainString(),
        saved.priceValue().toPlainString(),
        "outlet", Long.toString(saved.outletId()));
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
    audit("recipe", recipe.productId(), "update", "version", null, recipe.version(), "corporate", null);
    return recipe;
  }

  public void requireCatalogMutationForPublicAccess() {
    requireCatalogMutationAccess(RequestUserContextHolder.get());
  }

  private void requireCatalogMutationAccess(RequestUserContext context) {
    if (authorizationPolicyService.canMutateCatalog(context)) {
      return;
    }
    throw ServiceException.forbidden("Catalog management permission is required");
  }

  private void requireOutletReadAccess(RequestUserContext context, long outletId) {
    if (authorizationPolicyService.canReadCatalogForOutlet(context, outletId)) {
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

  private void audit(String entityType, long entityId, String action, String field, String oldVal, String newVal, String scopeType, String scopeId) {
    try {
      Long userId = null;
      try { userId = RequestUserContextHolder.get().userId(); } catch (Exception ignored) {}
      publishRepository.writeAuditLog(entityType, entityId, action, field, oldVal, newVal, scopeType, scopeId, userId, null, null);
    } catch (Exception ignored) { /* audit should not break business operations */ }
  }

  public ProductDtos.ProductView updateProduct(long productId, ProductDtos.UpdateProductRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    ProductDtos.ProductView updated = productRepository.updateProduct(productId, request, context.userId());
    if (request.status() != null) {
      audit("product", productId, "status_change", "status", null, request.status(), "corporate", null);
    } else {
      audit("product", productId, "update", null, null, updated.name(), "corporate", null);
    }
    return updated;
  }

  public ProductDtos.ItemView updateItem(long itemId, ProductDtos.UpdateItemRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    ProductDtos.ItemView updated = productRepository.updateItem(itemId, request);
    audit("item", itemId, "update", null, null, updated.name(), "corporate", null);
    return updated;
  }

  public List<ProductDtos.AvailabilityView> listAvailability(Long productId, Long outletId) {
    return productRepository.listAvailability(productId, outletId);
  }

  public ProductDtos.AvailabilityView setAvailability(ProductDtos.SetAvailabilityRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    return productRepository.setAvailability(request);
  }

  public List<ProductDtos.CategoryView> listProductCategories() {
    return productRepository.listProductCategories();
  }

  public ProductDtos.CategoryView createProductCategory(ProductDtos.CreateCategoryRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    return productRepository.createProductCategory(request);
  }

  public ProductDtos.CategoryView updateProductCategory(String code, ProductDtos.UpdateCategoryRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    return productRepository.updateProductCategory(code, request);
  }

  public List<ProductDtos.CategoryView> listItemCategories() {
    return productRepository.listItemCategories();
  }

  public ProductDtos.CategoryView createItemCategory(ProductDtos.CreateCategoryRequest request) {
    RequestUserContext context = RequestUserContextHolder.get();
    requireCatalogMutationAccess(context);
    return productRepository.createItemCategory(request);
  }

  private static String trimToNull(String value) {
    if (value == null) {
      return null;
    }
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }
}
