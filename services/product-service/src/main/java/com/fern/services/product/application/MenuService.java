package com.fern.services.product.application;

import com.fern.common.spring.auth.AuthorizationPolicyService;
import com.fern.common.spring.auth.RequestUserContextHolder;
import com.fern.services.product.api.ProductDtos;
import com.fern.services.product.infrastructure.MenuRepository;
import java.util.List;
import java.util.Optional;
import org.springframework.stereotype.Service;

@Service
public class MenuService {

  private final MenuRepository menuRepository;
  private final AuthorizationPolicyService authorizationPolicyService;

  public MenuService(MenuRepository menuRepository, AuthorizationPolicyService authorizationPolicyService) {
    this.menuRepository = menuRepository;
    this.authorizationPolicyService = authorizationPolicyService;
  }

  public List<ProductDtos.MenuView> listMenus() {
    return menuRepository.listMenus();
  }

  public Optional<ProductDtos.MenuView> findMenu(long menuId) {
    return menuRepository.findMenu(menuId);
  }

  public ProductDtos.MenuView createMenu(ProductDtos.CreateMenuRequest request) {
    requireCatalogMutation();
    return menuRepository.createMenu(request);
  }

  public ProductDtos.MenuView updateMenu(long menuId, ProductDtos.UpdateMenuRequest request) {
    requireCatalogMutation();
    return menuRepository.updateMenu(menuId, request);
  }

  public ProductDtos.MenuCategoryView addCategory(long menuId, ProductDtos.AddMenuCategoryRequest request) {
    requireCatalogMutation();
    return menuRepository.addCategory(menuId, request);
  }

  public ProductDtos.MenuItemView addItem(long categoryId, ProductDtos.AddMenuItemRequest request) {
    requireCatalogMutation();
    return menuRepository.addItem(categoryId, request);
  }

  public void removeItem(long itemId) {
    requireCatalogMutation();
    menuRepository.removeItem(itemId);
  }

  public List<ProductDtos.MenuItemExclusionView> listExclusions(long menuId) {
    return menuRepository.listExclusions(menuId);
  }

  public void setExclusion(ProductDtos.SetMenuItemExclusionRequest request) {
    requireCatalogMutation();
    menuRepository.setExclusion(request);
  }

  public void removeExclusion(long menuItemId, long outletId) {
    requireCatalogMutation();
    menuRepository.removeExclusion(menuItemId, outletId);
  }

  public List<ProductDtos.ChannelView> listChannels() {
    return menuRepository.listChannels();
  }

  public List<ProductDtos.DaypartView> listDayparts() {
    return menuRepository.listDayparts();
  }

  private void requireCatalogMutation() {
    if (!authorizationPolicyService.canMutateCatalog(RequestUserContextHolder.get())) {
      throw com.fern.common.middleware.ServiceException.forbidden("Catalog mutation access required");
    }
  }
}
