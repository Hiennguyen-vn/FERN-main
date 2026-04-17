package com.fern.services.product.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.dorabets.common.middleware.ServiceException;
import com.dorabets.common.spring.auth.AuthorizationPolicyService;
import com.dorabets.common.spring.web.PagedResult;
import com.dorabets.common.spring.auth.RequestUserContext;
import com.dorabets.common.spring.auth.RequestUserContextHolder;
import com.dorabets.common.spring.events.TypedKafkaEventPublisher;
import com.fern.events.product.ProductPriceChangedEvent;
import com.fern.events.product.ProductRecipeUpdatedEvent;
import com.fern.services.product.api.ProductDtos;
import com.fern.services.product.infrastructure.ProductRepository;
import com.fern.services.product.infrastructure.PublishRepository;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class ProductServiceTest {

  @Mock
  private ProductRepository productRepository;
  @Mock
  private ProductPriceCacheService productPriceCacheService;
  @Mock
  private TypedKafkaEventPublisher kafkaEventPublisher;
  @Mock
  private AuthorizationPolicyService authorizationPolicyService;
  @Mock
  private PublishRepository publishRepository;

  private final Clock clock = Clock.fixed(Instant.parse("2026-03-27T00:00:00Z"), ZoneOffset.UTC);

  @AfterEach
  void clearContext() {
    RequestUserContextHolder.clear();
  }

  @Test
  void listPricesAllowsScopedOutletAccess() {
    RequestUserContextHolder.set(new RequestUserContext(
        21L, "manager", "sess-21", Set.of("outlet_manager"), Set.of(), Set.of(7L), true, false, null
    ));
    when(authorizationPolicyService.canReadCatalogForOutlet(any(), eq(7L))).thenReturn(true);
    LocalDate businessDate = LocalDate.parse("2026-03-27");
    List<ProductDtos.PriceView> prices = List.of(new ProductDtos.PriceView(
        11L,
        7L,
        "USD",
        new BigDecimal("4.50"),
        businessDate,
        null
    ));
    when(productRepository.listPrices(7L, null, businessDate, null, null, null, 50, 0))
        .thenReturn(PagedResult.of(prices, 50, 0, 1));

    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );
    PagedResult<ProductDtos.PriceView> result = service.listPrices(7L, null, businessDate, null, null, null, null, null);

    assertEquals(1, result.items().size());
    assertEquals(7L, result.items().getFirst().outletId());
  }

  @Test
  void createProductDelegatesWithAuthenticatedActor() {
    RequestUserContextHolder.set(new RequestUserContext(
        10L, "admin", "sess-10", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(authorizationPolicyService.canMutateCatalog(any())).thenReturn(true);
    ProductDtos.CreateProductRequest request = new ProductDtos.CreateProductRequest(
        "CF-01",
        "Cold Brew",
        "coffee",
        null,
        "Coffee"
    );
    ProductDtos.ProductView product = new ProductDtos.ProductView(11L, "CF-01", "Cold Brew", "coffee", "draft", null, "Coffee");
    when(productRepository.createProduct(request, 10L)).thenReturn(product);

    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );
    ProductDtos.ProductView result = service.createProduct(request);

    verify(productRepository).createProduct(request, 10L);
    assertEquals(11L, result.id());
  }

  @Test
  void findPriceUsesCacheLookup() {
    RequestUserContextHolder.set(new RequestUserContext(
        21L, "manager", "sess-21", Set.of("outlet_manager"), Set.of(), Set.of(7L), true, false, null
    ));
    when(authorizationPolicyService.canReadCatalogForOutlet(any(), eq(7L))).thenReturn(true);
    LocalDate businessDate = LocalDate.parse("2026-03-27");
    ProductDtos.PriceView price = new ProductDtos.PriceView(
        11L,
        7L,
        "USD",
        new BigDecimal("4.50"),
        businessDate,
        null
    );
    when(productPriceCacheService.getOrLoad(eq(11L), eq(7L), eq(businessDate), any())).thenReturn(price);

    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );
    ProductDtos.PriceView result = service.findPrice(11L, 7L, businessDate);

    assertEquals(new BigDecimal("4.50"), result.priceValue());
  }

  @Test
  void findPriceRejectsOutOfScopeOutlet() {
    RequestUserContextHolder.set(new RequestUserContext(
        21L, "manager", "sess-21", Set.of("outlet_manager"), Set.of(), Set.of(7L), true, false, null
    ));
    when(authorizationPolicyService.canReadCatalogForOutlet(any(), eq(9L))).thenReturn(false);
    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );

    assertThrows(ServiceException.class, () -> service.findPrice(11L, 9L, LocalDate.parse("2026-03-27")));
  }

  @Test
  void upsertPriceEvictsCacheAndPublishesEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        10L, "admin", "sess-10", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(authorizationPolicyService.canMutateCatalog(any())).thenReturn(true);
    ProductDtos.UpsertPriceRequest request = new ProductDtos.UpsertPriceRequest(
        11L,
        7L,
        "USD",
        new BigDecimal("5.00"),
        LocalDate.parse("2026-03-27"),
        null
    );
    ProductDtos.PriceView previous = new ProductDtos.PriceView(
        11L, 7L, "USD", new BigDecimal("4.50"), LocalDate.parse("2026-03-27"), null
    );
    ProductDtos.PriceView saved = new ProductDtos.PriceView(
        11L, 7L, "USD", new BigDecimal("5.00"), LocalDate.parse("2026-03-27"), null
    );
    when(productRepository.findPrice(11L, 7L, LocalDate.parse("2026-03-27"))).thenReturn(Optional.of(previous));
    when(productRepository.upsertPrice(request, 10L)).thenReturn(saved);

    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );
    ProductDtos.PriceView result = service.upsertPrice(request);

    verify(productPriceCacheService).evict(11L, 7L, LocalDate.parse("2026-03-27"));
    verify(kafkaEventPublisher).publish(
        eq("fern.product.product-price-changed"),
        eq("11"),
        eq("product.price.changed"),
        any(ProductPriceChangedEvent.class)
    );
    assertEquals(new BigDecimal("5.00"), result.priceValue());
  }

  @Test
  void upsertRecipePublishesRecipeUpdatedEvent() {
    RequestUserContextHolder.set(new RequestUserContext(
        10L, "admin", "sess-10", Set.of("admin"), Set.of(), Set.of(), true, false, null
    ));
    when(authorizationPolicyService.canMutateCatalog(any())).thenReturn(true);
    ProductDtos.UpsertRecipeRequest request = new ProductDtos.UpsertRecipeRequest(
        "v1",
        new BigDecimal("1.0000"),
        "cup",
        "active",
        List.of(new ProductDtos.RecipeLineRequest(22L, "gram", new BigDecimal("18.0000")))
    );
    ProductDtos.RecipeView recipe = new ProductDtos.RecipeView(
        11L,
        "v1",
        new BigDecimal("1.0000"),
        "cup",
        "active",
        List.of(new ProductDtos.RecipeLineView(22L, "gram", new BigDecimal("18.0000")))
    );
    when(productRepository.upsertRecipe(11L, request, 10L)).thenReturn(recipe);

    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );
    ProductDtos.RecipeView result = service.upsertRecipe(11L, request);

    verify(kafkaEventPublisher).publish(
        eq("fern.product.product-recipe-updated"),
        eq("11"),
        eq("product.recipe.updated"),
        any(ProductRecipeUpdatedEvent.class)
    );
    assertEquals("v1", result.version());
  }

  @Test
  void resolveRecipeThrowsWhenMissing() {
    when(productRepository.findRecipe(11L, null)).thenReturn(Optional.empty());
    ProductService service = new ProductService(
        productRepository,
        productPriceCacheService,
        kafkaEventPublisher,
        authorizationPolicyService,
        publishRepository,
        clock
    );

    assertThrows(ServiceException.class, () -> service.resolveRecipe(11L, null));
  }
}
