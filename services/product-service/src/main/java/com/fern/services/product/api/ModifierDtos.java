package com.fern.services.product.api;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;

public final class ModifierDtos {

  private ModifierDtos() {
  }

  public record ModifierOptionView(
      long id,
      String code,
      String label,
      BigDecimal priceDelta,
      boolean isDefault,
      boolean active,
      int sortOrder
  ) {
  }

  public record ModifierGroupView(
      long id,
      String code,
      String name,
      String selectionType,
      int minSelect,
      int maxSelect,
      boolean required,
      boolean active,
      List<ModifierOptionView> options
  ) {
  }

  public record CreateModifierGroupRequest(
      @NotBlank String code,
      @NotBlank String name,
      String selectionType,
      Integer minSelect,
      Integer maxSelect,
      Boolean required,
      @Valid List<CreateModifierOptionRequest> options
  ) {
  }

  public record CreateModifierOptionRequest(
      @NotBlank String code,
      @NotBlank String label,
      BigDecimal priceDelta,
      Boolean isDefault,
      Integer sortOrder
  ) {
  }

  public record UpdateModifierGroupRequest(
      @NotBlank String code,
      @NotBlank String name,
      String selectionType,
      @NotNull Integer minSelect,
      @NotNull Integer maxSelect,
      @NotNull Boolean required,
      @NotNull Boolean active,
      @Valid List<UpdateModifierOptionRequest> options
  ) {
  }

  public record UpdateModifierOptionRequest(
      Long id,
      @NotBlank String code,
      @NotBlank String label,
      @NotNull BigDecimal priceDelta,
      @NotNull Boolean isDefault,
      @NotNull Boolean active,
      @NotNull Integer sortOrder
  ) {
  }

  public record AssignProductGroupsRequest(
      @NotNull List<ProductModifierGroupAssignment> groups
  ) {
  }

  public record ProductModifierGroupAssignment(
      @NotNull Long groupId,
      Integer sortOrder
  ) {
  }
}
