package com.fern.services.procurement.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.events.procurement.GoodsReceiptPostedEvent;
import com.fern.services.procurement.application.GoodsReceiptService;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/procurement/goods-receipts")
public class GoodsReceiptController {

  private final GoodsReceiptService goodsReceiptService;

  public GoodsReceiptController(GoodsReceiptService goodsReceiptService) {
    this.goodsReceiptService = goodsReceiptService;
  }

  @PostMapping
  public ResponseEntity<ProcurementDtos.GoodsReceiptView> createGoodsReceipt(
      @Valid @RequestBody ProcurementDtos.CreateGoodsReceiptRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(goodsReceiptService.createGoodsReceipt(request));
  }

  @GetMapping("/{receiptId}")
  public ProcurementDtos.GoodsReceiptView getGoodsReceipt(@PathVariable long receiptId) {
    return goodsReceiptService.getGoodsReceipt(receiptId);
  }

  @GetMapping
  public PagedResult<ProcurementDtos.GoodsReceiptListItemView> listGoodsReceipts(
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) Long poId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return goodsReceiptService.listGoodsReceipts(
        outletId,
        poId,
        status,
        startDate,
        endDate,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @PostMapping("/{receiptId}/approve")
  public ProcurementDtos.GoodsReceiptView approveGoodsReceipt(@PathVariable long receiptId) {
    return goodsReceiptService.approveGoodsReceipt(receiptId);
  }

  @PostMapping("/{receiptId}/post")
  public GoodsReceiptPostedEvent postGoodsReceipt(@PathVariable long receiptId) {
    return goodsReceiptService.postGoodsReceipt(receiptId);
  }
}
