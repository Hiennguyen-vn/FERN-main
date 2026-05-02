package com.fern.services.product.api;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

public final class AllergenDtos {

  private AllergenDtos() {
  }

  public record AllergenView(
      String code,
      String label,
      String labelEn,
      String icon,
      int sortOrder
  ) {
  }

  public record ProductAllergenView(
      String code,
      String label,
      String labelEn,
      String icon,
      boolean isTraces
  ) {
  }

  public record ProductAllergenInput(
      @NotBlank String code,
      boolean isTraces
  ) {
  }

  public record SetProductAllergensRequest(
      List<ProductAllergenInput> allergens
  ) {
  }

  public record CustomerAllergyView(
      String code,
      String label,
      String labelEn,
      String icon,
      String severity,
      String note
  ) {
  }

  public record CustomerAllergyInput(
      @NotBlank String code,
      String severity,
      String note
  ) {
  }

  public record SetCustomerAllergiesRequest(
      List<CustomerAllergyInput> allergies
  ) {
  }

  public record ProductAllergenMapEntry(
      long productId,
      List<ProductAllergenView> allergens
  ) {
  }
}
