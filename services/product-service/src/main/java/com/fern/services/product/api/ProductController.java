package com.fern.services.product.api;

import com.fern.common.middleware.ServiceException;
import com.fern.common.spring.web.PagedResult;
import com.fern.services.product.application.ProductService;
import com.fern.services.product.infrastructure.ProductImageStorage;
import com.fern.services.product.infrastructure.VariantRepository;
import jakarta.validation.Valid;
import java.io.IOException;
import java.time.LocalDate;
import java.util.List;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/product")
public class ProductController {

  private final ProductService productService;
  private final VariantRepository variantRepository;
  private final ObjectProvider<ProductImageStorage> imageStorageProvider;

  public ProductController(
      ProductService productService,
      VariantRepository variantRepository,
      ObjectProvider<ProductImageStorage> imageStorageProvider
  ) {
    this.productService = productService;
    this.variantRepository = variantRepository;
    this.imageStorageProvider = imageStorageProvider;
  }

  @GetMapping("/products")
  public PagedResult<ProductDtos.ProductView> products(
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String categoryCode,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return productService.listProducts(status, categoryCode, q, sortBy, sortDir, limit, offset);
  }

  @PostMapping("/products")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.ProductView createProduct(@Valid @RequestBody ProductDtos.CreateProductRequest request) {
    return productService.createProduct(request);
  }

  @GetMapping("/items")
  public PagedResult<ProductDtos.ItemView> items(
      @RequestParam(required = false) String status,
      @RequestParam(required = false) String categoryCode,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return productService.listItems(status, categoryCode, q, sortBy, sortDir, limit, offset);
  }

  @PostMapping("/items")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.ItemView createItem(@Valid @RequestBody ProductDtos.CreateItemRequest request) {
    return productService.createItem(request);
  }

  @GetMapping("/prices/{productId}")
  public ProductDtos.PriceView price(
      @PathVariable long productId,
      @RequestParam long outletId,
      @RequestParam(name = "on", required = false) LocalDate onDate
  ) {
    return productService.findPrice(productId, outletId, onDate);
  }

  @GetMapping("/prices")
  public PagedResult<ProductDtos.PriceView> prices(
      @RequestParam long outletId,
      @RequestParam(required = false) Long productId,
      @RequestParam(name = "on", required = false) LocalDate onDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return productService.listPrices(outletId, productId, onDate, q, sortBy, sortDir, limit, offset);
  }

  @PutMapping("/prices")
  public ProductDtos.PriceView upsertPrice(@Valid @RequestBody ProductDtos.UpsertPriceRequest request) {
    return productService.upsertPrice(request);
  }

  @GetMapping("/recipes/{productId}")
  public ProductDtos.RecipeView recipe(
      @PathVariable long productId,
      @RequestParam(name = "version", required = false) String version
  ) {
    return productService.resolveRecipe(productId, version);
  }

  @PutMapping("/recipes/{productId}")
  public ProductDtos.RecipeView upsertRecipe(
      @PathVariable long productId,
      @Valid @RequestBody ProductDtos.UpsertRecipeRequest request
  ) {
    return productService.upsertRecipe(productId, request);
  }

  @PutMapping("/products/{productId}")
  public ProductDtos.ProductView updateProduct(
      @PathVariable long productId,
      @RequestBody ProductDtos.UpdateProductRequest request
  ) {
    return productService.updateProduct(productId, request);
  }

  @PostMapping("/products/{productId}/image/presign")
  public ProductDtos.PresignedUploadResult presignImageUpload(
      @PathVariable long productId,
      @Valid @RequestBody ProductDtos.PresignImageRequest request
  ) {
    productService.requireCatalogMutationForPublicAccess();
    ProductImageStorage storage = imageStorageProvider.getIfAvailable();
    if (storage == null) {
      throw ServiceException.badRequest("Image upload is not configured for this environment");
    }
    return storage.presignUpload(productId, request.contentType(), request.size());
  }

  @PostMapping(value = "/products/{productId}/image/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
  public ProductDtos.PresignedUploadResult uploadImage(
      @PathVariable long productId,
      @RequestPart("file") MultipartFile file
  ) {
    productService.requireCatalogMutationForPublicAccess();
    ProductImageStorage storage = imageStorageProvider.getIfAvailable();
    if (storage == null) {
      throw ServiceException.badRequest("Image upload is not configured for this environment");
    }
    try {
      return storage.uploadObject(
          productId,
          file.getContentType(),
          file.getOriginalFilename(),
          file.getBytes()
      );
    } catch (IOException ex) {
      throw ServiceException.badRequest("Failed to read uploaded image");
    }
  }

  @GetMapping("/product-images")
  public ResponseEntity<byte[]> productImage(@RequestParam String key) {
    ProductImageStorage storage = imageStorageProvider.getIfAvailable();
    if (storage == null) {
      throw ServiceException.notFound("Image storage is not configured");
    }
    ProductImageStorage.StoredObject object = storage.readObject(key);
    return ResponseEntity.ok()
        .cacheControl(CacheControl.noCache())
        .header(HttpHeaders.CONTENT_TYPE, object.contentType())
        .body(object.data());
  }

  @PutMapping("/items/{itemId}")
  public ProductDtos.ItemView updateItem(
      @PathVariable long itemId,
      @RequestBody ProductDtos.UpdateItemRequest request
  ) {
    return productService.updateItem(itemId, request);
  }

  @GetMapping("/availability")
  public java.util.List<ProductDtos.AvailabilityView> availability(
      @RequestParam(required = false) Long productId,
      @RequestParam(required = false) Long outletId
  ) {
    return productService.listAvailability(productId, outletId);
  }

  @PutMapping("/availability")
  public ProductDtos.AvailabilityView setAvailability(
      @Valid @RequestBody ProductDtos.SetAvailabilityRequest request
  ) {
    return productService.setAvailability(request);
  }

  @GetMapping("/categories")
  public List<ProductDtos.CategoryView> listProductCategories() {
    return productService.listProductCategories();
  }

  @PostMapping("/categories")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.CategoryView createProductCategory(
      @Valid @RequestBody ProductDtos.CreateCategoryRequest request
  ) {
    return productService.createProductCategory(request);
  }

  @PutMapping("/categories/{code}")
  public ProductDtos.CategoryView updateProductCategory(
      @PathVariable String code,
      @RequestBody ProductDtos.UpdateCategoryRequest request
  ) {
    return productService.updateProductCategory(code, request);
  }

  @GetMapping("/item-categories")
  public List<ProductDtos.CategoryView> listItemCategories() {
    return productService.listItemCategories();
  }

  @PostMapping("/item-categories")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.CategoryView createItemCategory(
      @Valid @RequestBody ProductDtos.CreateCategoryRequest request
  ) {
    return productService.createItemCategory(request);
  }

  // ── Variants ──────────────────────────────────────────

  @GetMapping("/variants")
  public java.util.List<ProductDtos.VariantView> listVariants(@RequestParam long productId) {
    return variantRepository.listVariants(productId);
  }

  @PostMapping("/variants")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.VariantView createVariant(@Valid @RequestBody ProductDtos.CreateVariantRequest request) {
    return variantRepository.createVariant(request);
  }

  @DeleteMapping("/variants/{variantId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteVariant(@PathVariable long variantId) {
    variantRepository.deleteVariant(variantId);
  }

  // ── Modifier Groups ───────────────────────────────────

  @GetMapping("/modifier-groups")
  public java.util.List<ProductDtos.ModifierGroupView> listModifierGroups() {
    return variantRepository.listModifierGroups();
  }

  @PostMapping("/modifier-groups")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.ModifierGroupView createModifierGroup(@Valid @RequestBody ProductDtos.CreateModifierGroupRequest request) {
    return variantRepository.createModifierGroup(request);
  }

  @PostMapping("/modifier-groups/{groupId}/options")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.ModifierOptionView addModifierOption(@PathVariable long groupId, @Valid @RequestBody ProductDtos.AddModifierOptionRequest request) {
    return variantRepository.addOption(groupId, request);
  }

  @DeleteMapping("/modifier-options/{optionId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteModifierOption(@PathVariable long optionId) {
    variantRepository.deleteOption(optionId);
  }
}
