package com.fern.services.product.api;

import com.fern.services.product.application.MenuService;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/product")
public class MenuController {

  private final MenuService menuService;

  public MenuController(MenuService menuService) {
    this.menuService = menuService;
  }

  // ── Menu ──────────────────────────────────────────────

  @GetMapping("/menus")
  public List<ProductDtos.MenuView> listMenus() {
    return menuService.listMenus();
  }

  @GetMapping("/menus/{menuId}")
  public ProductDtos.MenuView getMenu(@PathVariable long menuId) {
    return menuService.findMenu(menuId)
        .orElseThrow(() -> com.dorabets.common.middleware.ServiceException.notFound("Menu not found: " + menuId));
  }

  @PostMapping("/menus")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.MenuView createMenu(@Valid @RequestBody ProductDtos.CreateMenuRequest request) {
    return menuService.createMenu(request);
  }

  @PutMapping("/menus/{menuId}")
  public ProductDtos.MenuView updateMenu(
      @PathVariable long menuId,
      @RequestBody ProductDtos.UpdateMenuRequest request
  ) {
    return menuService.updateMenu(menuId, request);
  }

  // ── Categories ────────────────────────────────────────

  @PostMapping("/menus/{menuId}/categories")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.MenuCategoryView addCategory(
      @PathVariable long menuId,
      @Valid @RequestBody ProductDtos.AddMenuCategoryRequest request
  ) {
    return menuService.addCategory(menuId, request);
  }

  // ── Items ─────────────────────────────────────────────

  @PostMapping("/menus/categories/{categoryId}/items")
  @ResponseStatus(HttpStatus.CREATED)
  public ProductDtos.MenuItemView addItem(
      @PathVariable long categoryId,
      @Valid @RequestBody ProductDtos.AddMenuItemRequest request
  ) {
    return menuService.addItem(categoryId, request);
  }

  @DeleteMapping("/menus/items/{itemId}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void removeItem(@PathVariable long itemId) {
    menuService.removeItem(itemId);
  }

  // ── Exclusions ────────────────────────────────────────

  @GetMapping("/menus/{menuId}/exclusions")
  public List<ProductDtos.MenuItemExclusionView> listExclusions(@PathVariable long menuId) {
    return menuService.listExclusions(menuId);
  }

  @PutMapping("/menus/exclusions")
  public void setExclusion(@Valid @RequestBody ProductDtos.SetMenuItemExclusionRequest request) {
    menuService.setExclusion(request);
  }

  @DeleteMapping("/menus/exclusions")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void removeExclusion(@RequestParam long menuItemId, @RequestParam long outletId) {
    menuService.removeExclusion(menuItemId, outletId);
  }

  // ── Reference data ────────────────────────────────────

  @GetMapping("/channels")
  public List<ProductDtos.ChannelView> listChannels() {
    return menuService.listChannels();
  }

  @GetMapping("/dayparts")
  public List<ProductDtos.DaypartView> listDayparts() {
    return menuService.listDayparts();
  }
}
