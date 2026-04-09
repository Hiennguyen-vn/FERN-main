package com.fern.services.product.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.product.application.ProductService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/product")
public class ProductController {

  private final ProductService productService;

  public ProductController(ProductService productService) {
    this.productService = productService;
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
}
