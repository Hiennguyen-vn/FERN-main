package com.fern.services.sales.api;

import com.fern.services.sales.application.PublicPosService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/sales/public")
public class PublicPosController {

  private final PublicPosService publicPosService;

  public PublicPosController(PublicPosService publicPosService) {
    this.publicPosService = publicPosService;
  }

  @GetMapping("/tables/{tableToken}")
  public PublicPosDtos.PublicTableView getTable(@PathVariable String tableToken) {
    return publicPosService.getTable(tableToken);
  }

  @GetMapping("/tables/{tableToken}/menu")
  public List<PublicPosDtos.PublicMenuItemView> listMenu(
      @PathVariable String tableToken,
      @RequestParam(required = false) LocalDate onDate
  ) {
    return publicPosService.listMenu(tableToken, onDate);
  }

  @GetMapping("/tables/{tableToken}/orders/{orderToken}")
  public PublicPosDtos.PublicOrderReceiptView getOrder(
      @PathVariable String tableToken,
      @PathVariable String orderToken
  ) {
    return publicPosService.getOrder(tableToken, orderToken);
  }

  @PostMapping("/tables/{tableToken}/orders")
  @ResponseStatus(HttpStatus.CREATED)
  public PublicPosDtos.PublicOrderReceiptView createOrder(
      @PathVariable String tableToken,
      @Valid @RequestBody PublicPosDtos.CreatePublicOrderRequest request
  ) {
    return publicPosService.createOrder(tableToken, request);
  }
}
