package com.fern.services.procurement.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.procurement.application.SupplierService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/procurement/suppliers")
public class SupplierController {

  private final SupplierService supplierService;

  public SupplierController(SupplierService supplierService) {
    this.supplierService = supplierService;
  }

  @PostMapping
  public ResponseEntity<ProcurementDtos.SupplierView> createSupplier(
      @Valid @RequestBody ProcurementDtos.CreateSupplierRequest request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(supplierService.createSupplier(request));
  }

  @GetMapping("/{supplierId}")
  public ProcurementDtos.SupplierView getSupplier(@PathVariable long supplierId) {
    return supplierService.getSupplier(supplierId);
  }

  @GetMapping
  public PagedResult<ProcurementDtos.SupplierView> listSuppliers(
      @RequestParam(required = false) Long regionId,
      @RequestParam(required = false) String status,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return supplierService.listSuppliers(regionId, status, q, sortBy, sortDir, limit, offset);
  }

  @PutMapping("/{supplierId}")
  public ProcurementDtos.SupplierView updateSupplier(
      @PathVariable long supplierId,
      @Valid @RequestBody ProcurementDtos.UpdateSupplierRequest request
  ) {
    return supplierService.updateSupplier(supplierId, request);
  }
}
