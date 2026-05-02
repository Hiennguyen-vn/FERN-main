package com.fern.services.product.api;

import com.fern.services.product.infrastructure.AllergenRepository;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class AllergenController {

  private final AllergenRepository allergenRepository;

  public AllergenController(AllergenRepository allergenRepository) {
    this.allergenRepository = allergenRepository;
  }

  @GetMapping("/allergens")
  public List<AllergenDtos.AllergenView> listAllergens() {
    return allergenRepository.listAll();
  }

  @GetMapping("/products/{productId}/allergens")
  public List<AllergenDtos.ProductAllergenView> listForProduct(@PathVariable long productId) {
    return allergenRepository.listForProduct(productId);
  }

  @GetMapping("/product-allergens")
  public List<AllergenDtos.ProductAllergenMapEntry> listForAllProducts() {
    return allergenRepository.listForAllProducts();
  }

  @PutMapping("/products/{productId}/allergens")
  public List<AllergenDtos.ProductAllergenView> setForProduct(
      @PathVariable long productId,
      @Valid @RequestBody AllergenDtos.SetProductAllergensRequest request
  ) {
    return allergenRepository.setForProduct(productId, request.allergens());
  }

  @GetMapping("/customer-allergies/{customerId}")
  public List<AllergenDtos.CustomerAllergyView> listForCustomer(@PathVariable long customerId) {
    return allergenRepository.listForCustomer(customerId);
  }

  @PutMapping("/customer-allergies/{customerId}")
  public List<AllergenDtos.CustomerAllergyView> setForCustomer(
      @PathVariable long customerId,
      @Valid @RequestBody AllergenDtos.SetCustomerAllergiesRequest request
  ) {
    return allergenRepository.setForCustomer(customerId, request.allergies());
  }
}
