package com.fern.services.product.api;

import com.fern.common.middleware.ServiceException;
import com.fern.services.product.infrastructure.ModifierRepository;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1")
public class ModifierController {

  private final ModifierRepository modifierRepository;

  public ModifierController(ModifierRepository modifierRepository) {
    this.modifierRepository = modifierRepository;
  }

  @GetMapping("/modifier-groups")
  public List<ModifierDtos.ModifierGroupView> listGroups() {
    return modifierRepository.listGroups();
  }

  @GetMapping("/modifier-groups/{groupId}")
  public ModifierDtos.ModifierGroupView getGroup(@PathVariable long groupId) {
    return modifierRepository.findGroup(groupId)
        .orElseThrow(() -> ServiceException.notFound("Modifier group not found: " + groupId));
  }

  @PostMapping("/modifier-groups")
  @ResponseStatus(HttpStatus.CREATED)
  public ModifierDtos.ModifierGroupView createGroup(@Valid @RequestBody ModifierDtos.CreateModifierGroupRequest req) {
    return modifierRepository.createGroup(req);
  }

  @PutMapping("/modifier-groups/{groupId}")
  public ModifierDtos.ModifierGroupView updateGroup(
      @PathVariable long groupId,
      @Valid @RequestBody ModifierDtos.UpdateModifierGroupRequest req
  ) {
    return modifierRepository.updateGroup(groupId, req);
  }

  @DeleteMapping("/modifier-groups/{groupId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void deleteGroup(@PathVariable long groupId) {
    modifierRepository.deleteGroup(groupId);
  }

  @GetMapping("/products/{productId}/modifier-groups")
  public List<ModifierDtos.ModifierGroupView> listForProduct(@PathVariable long productId) {
    return modifierRepository.listForProduct(productId);
  }

  @PutMapping("/products/{productId}/modifier-groups")
  public List<ModifierDtos.ModifierGroupView> assignToProduct(
      @PathVariable long productId,
      @Valid @RequestBody ModifierDtos.AssignProductGroupsRequest req
  ) {
    return modifierRepository.assignToProduct(productId, req.groups());
  }
}
