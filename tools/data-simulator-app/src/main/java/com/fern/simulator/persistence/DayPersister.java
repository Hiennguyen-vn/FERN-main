package com.fern.simulator.persistence;

import com.fern.simulator.config.SimulationConfig;
import com.fern.simulator.engine.SimulationContext;
import com.fern.simulator.economics.RegionalEconomics;
import com.fern.simulator.model.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.Connection;
import java.sql.SQLException;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Persists simulation state to the database after each simulated day.
 * <p>
 * Uses dirty-tracking sets from {@link SimulationContext} to detect new entities,
 * and writes them in FK-safe order within a single transaction per day.
 */
public class DayPersister {

    private static final Logger log = LoggerFactory.getLogger(DayPersister.class);

    private final Connection conn;
    private long totalRowsWritten = 0;
    private long totalPersistMillis = 0;
    private final Map<String, Long> sectionTimingsMillis = new LinkedHashMap<>();

    public DayPersister(Connection conn) {
        this.conn = conn;
    }

    /**
     * Persist all new entities created on this day.
     * Called by SimulationEngine after all phases have executed for a day.
     */
    public void persistDay(SimulationContext ctx, LocalDate day) throws SQLException {
        conn.setAutoCommit(false);
        long persistStartedAt = System.nanoTime();
        try (var batchWriter = new SimulatorBatchWriter(conn)) {
            // Bypass stock balance trigger for simulator writes
            try (var stmt = conn.createStatement()) {
                stmt.execute("SET LOCAL fern.simulator_cleanup = 'on'");
            }

            // 1. Regions (newly activated)
            for (String regionCode : ctx.getDirtyRegions()) {
                Long regionId = ctx.getRegionId(regionCode);
                if (regionId == null) continue;

                // Check if region already exists in DB — if so, remap the context ID
                Long existingId = lookupExistingRegionId(conn, regionCode);
                if (existingId != null) {
                    // Region already exists in DB — remap so all child entities use correct FK
                    ctx.remapRegionId(regionCode, existingId);
                    log.debug("Region {} already exists in DB with id={}, remapped", regionCode, existingId);
                } else {
                    SimulationConfig.RegionConfig regionConfig = findRegionConfig(ctx, regionCode);
                    if (regionConfig == null) continue;

                    SimulatorRepository.insertRegion(conn, regionId, regionCode,
                            "Region " + regionConfig.code(), regionConfig.currency(), regionConfig.timezone(), null);
                    totalRowsWritten++;
                }
            }

            // 2. Outlets (newly created)
            for (SimOutlet outlet : ctx.getDirtyOutlets()) {
                SimulatorRepository.insertOutlet(conn, outlet);
                totalRowsWritten++;
            }

            // 3. Outlet status updates (closures)
            for (SimOutlet outlet : ctx.getDirtyOutletUpdates()) {
                SimulatorRepository.updateOutletStatus(conn, outlet.getId(),
                        outlet.getStatus(),
                        outlet.getClosedAt() != null ? outlet.getClosedAt().toLocalDate() : null);
                totalRowsWritten++;
            }

            // 4. Items (global catalog)
            for (SimItem item : ctx.getDirtyItems()) {
                SimulatorRepository.insertItem(conn, item);
                totalRowsWritten++;
            }

            // 5. Suppliers
            for (SimSupplier supplier : ctx.getDirtySuppliers()) {
                Long regionId = ctx.getRegionId(supplier.regionCode());
                SimulatorRepository.insertSupplier(conn, supplier, regionId);
                totalRowsWritten++;
            }

            // 6. Products + Recipes + Prices
            for (SimProduct product : ctx.getDirtyProducts()) {
                SimulatorRepository.insertProduct(conn, product);
                totalRowsWritten++;

                // Create recipe
                String version = "v1";
                SimulatorRepository.insertRecipe(conn, product.id(), version);
                totalRowsWritten++;

                for (SimProduct.RecipeItem ri : product.recipeItems()) {
                    SimulatorRepository.insertRecipeItem(conn, product.id(), version,
                            ri.itemId(), ri.uomCode(), ri.quantity());
                    totalRowsWritten++;
                }

                // Product prices for all active outlets
                for (SimOutlet outlet : ctx.getActiveOutlets()) {
                    String marketCode = RegionalEconomics.marketCode(outlet);
                    long effectiveCost = RegionalEconomics.effectiveProductCost(
                            ctx.getItems(), product, marketCode, ctx.getConfig().startDate(), day);
                    long effectivePrice = RegionalEconomics.effectiveProductPrice(
                            product, effectiveCost, outlet, ctx.getConfig().startDate(), day);
                    SimulatorRepository.insertProductPrice(conn, product.id(), outlet.getId(),
                            RegionalEconomics.currencyFor(marketCode), effectivePrice, day);
                    SimulatorRepository.insertProductOutletAvailability(conn, product.id(), outlet.getId());
                    totalRowsWritten += 2;
                }
            }

            // 6b. Ensure new outlets always have pricing + availability for existing products.
            // Catalog products may already exist when expansion opens additional outlets.
            if (!ctx.getDirtyOutlets().isEmpty() && !ctx.getProducts().isEmpty()) {
                for (SimOutlet outlet : ctx.getDirtyOutlets()) {
                    if (!outlet.isActive()) {
                        continue;
                    }
                    String marketCode = RegionalEconomics.marketCode(outlet);
                    String currencyCode = RegionalEconomics.currencyFor(marketCode);
                    for (SimProduct product : ctx.getProducts().values()) {
                        long effectiveCost = RegionalEconomics.effectiveProductCost(
                                ctx.getItems(), product, marketCode, ctx.getConfig().startDate(), day);
                        long effectivePrice = RegionalEconomics.effectiveProductPrice(
                                product, effectiveCost, outlet, ctx.getConfig().startDate(), day);
                        SimulatorRepository.insertProductPrice(
                                conn,
                                product.id(),
                                outlet.getId(),
                                currencyCode,
                                effectivePrice,
                                day);
                        SimulatorRepository.insertProductOutletAvailability(conn, product.id(), outlet.getId());
                        totalRowsWritten += 2;
                    }
                }
            }

            // 7. Employees (newly hired)
            for (SimEmployee emp : ctx.getDirtyEmployees()) {
                SimulatorRepository.insertAppUser(conn, emp);
                SimulatorRepository.insertEmployeeContract(conn, emp);
                totalRowsWritten += 2;

                // Assign role if present
                if (emp.hasRole()) {
                    SimulatorRepository.insertUserRole(conn, emp.getUserId(),
                            emp.getRoleCode(), emp.getOutletId());
                    totalRowsWritten++;
                }
            }

            // 8. Employee status updates (departures)
            for (SimEmployee emp : ctx.getDirtyEmployeeUpdates()) {
                updateUserStatus(conn, emp);
                totalRowsWritten++;
            }

            // 8b. Shifts + Ordering tables for newly opened outlets.
            // Persist these FK targets before any high-volume sales batching can auto-flush.
            for (var shift : ctx.getDirtyShifts()) {
                SimulatorRepository.insertShift(conn, shift.id(), shift.outletId(),
                        shift.code(), shift.name(), shift.startTime(), shift.endTime(), shift.breakMinutes());
                totalRowsWritten++;
            }
            for (var table : ctx.getDirtyOrderingTables()) {
                SimulatorRepository.insertOrderingTable(conn, table.id(), table.outletId(),
                        table.tableCode(), table.displayName(), table.publicToken());
                totalRowsWritten++;
            }

            // 9. Purchase Orders (newly created)
            for (SimulationContext.PendingPurchaseOrder po : ctx.getDirtyPOs()) {
                SimulatorRepository.insertPurchaseOrder(conn, po.poId(), po.supplierId(),
                        po.outletId(), po.currencyCode(), day,
                        po.expectedDeliveryDate(), po.createdByUserId(),
                        po.approvedByUserId(), po.expectedTotal(), po.note());
                totalRowsWritten++;

                for (var entry : po.orderedQuantities().entrySet()) {
                    SimItem item = ctx.getItems().get(entry.getKey());
                    String uomCode = item != null ? item.getUomCode() : "g";
                    long expectedUnitPrice = item != null ? item.getUnitCost() : 10_000L;
                    batchWriter.insertPurchaseOrderItem(po.poId(), entry.getKey(), uomCode, entry.getValue(), expectedUnitPrice);
                    totalRowsWritten++;
                }
            }

            long goodsReceiptStartedAt = System.nanoTime();
            // 10. Goods Receipts (delivered today)
            for (var gr : ctx.getDirtyGoodsReceipts()) {
                long grId = ctx.getIdGen().nextId();
                SimulatorRepository.insertGoodsReceipt(conn, grId, gr.poId(),
                        gr.currencyCode(), gr.receiptTime(), gr.businessDate(), gr.totalPrice(),
                        "posted", gr.note(), gr.supplierLotNumber(), gr.createdByUserId(),
                        gr.approvedByUserId(), gr.receiptTime());
                totalRowsWritten++;

                // Store grId for invoice receipt linking
                ctx.storeGoodsReceiptId(gr.poId(), grId);

                java.util.Map<Long, Long> griIds = new java.util.LinkedHashMap<>();
                boolean poComplete = true;
                for (var entry : gr.receivedQuantities().entrySet()) {
                    long griId = ctx.getIdGen().nextId();
                    SimItem globalItem = ctx.getItems().get(entry.getKey());
                    long unitCost = globalItem != null ? globalItem.getUnitCost() : 10000L;
                    String uomCode = globalItem != null ? globalItem.getUomCode() : "g";
                    batchWriter.insertGoodsReceiptItem(griId, grId, gr.poId(),
                            entry.getKey(), uomCode, entry.getValue(), unitCost,
                            gr.manufactureDate(), gr.expiryDate(), gr.note());
                    totalRowsWritten++;
                    griIds.put(entry.getKey(), griId);

                    // Inventory transaction: purchase_in
                    long txnId = ctx.getIdGen().nextId();
                    batchWriter.insertInventoryTransaction(txnId, gr.outletId(),
                            entry.getKey(), entry.getValue(), gr.businessDate(), gr.receiptTime(),
                            "purchase_in", unitCost, gr.createdByUserId(), gr.note());
                    batchWriter.insertGoodsReceiptTransaction(txnId, griId);
                    totalRowsWritten += 2;

                    int orderedQty = gr.orderedQuantities().getOrDefault(entry.getKey(), entry.getValue());
                    int cumulativeQty = gr.cumulativeReceivedQuantities().getOrDefault(entry.getKey(), entry.getValue());
                    String itemStatus = cumulativeQty >= orderedQty ? "completed" : "partially_received";
                    if (cumulativeQty < orderedQty) {
                        poComplete = false;
                    }
                    SimulatorRepository.updatePurchaseOrderItemReceipt(conn, gr.poId(), entry.getKey(),
                            cumulativeQty, itemStatus, gr.note());
                }

                // Store GRI IDs for invoice item linking
                ctx.storeGoodsReceiptItemIds(gr.poId(), griIds);
                SimulatorRepository.updatePurchaseOrderStatus(conn, gr.poId(),
                        poComplete && !gr.partial() ? "completed" : "partially_received");
            }
            recordSection("goodsReceiptsMs", goodsReceiptStartedAt);

            // 11. Promotions
            for (SimPromotion promo : ctx.getDirtyPromotions()) {
                SimulatorRepository.insertPromotion(conn, promo);
                totalRowsWritten++;
            }

            long salesStartedAt = System.nanoTime();
            // 12. POS Sessions
            for (var posSession : ctx.getDirtyPosSessions()) {
                batchWriter.insertPosSession(posSession.id(), posSession.sessionCode(), posSession.outletId(),
                        posSession.currencyCode(), posSession.managerId(), posSession.openedAt(),
                        posSession.closedAt(), posSession.businessDate(), posSession.status());
                totalRowsWritten++;
            }

            // 13. Sales (persisted as batched events)
            for (var sale : ctx.getDirtySales()) {
                batchWriter.insertSaleRecord(sale.saleId(), sale.outletId(),
                        sale.posSessionId(), sale.currencyCode(), sale.orderType(),
                        sale.status(), sale.paymentStatus(),
                        sale.subtotal(), sale.discount(), sale.taxAmount(), sale.totalAmount(),
                        sale.orderingTableId());
                totalRowsWritten++;

                for (var item : sale.items()) {
                    batchWriter.insertSaleItem(sale.saleId(), item.productId(),
                            item.unitPrice(), item.qty(), item.discountAmount(),
                            item.taxAmount(), item.lineTotal());
                    totalRowsWritten++;
                }

                if (sale.paymentAmount() > 0) {
                    String paymentTxnStatus = switch (sale.paymentStatus()) {
                        case "refunded" -> "refunded";
                        case "unpaid" -> "cancelled";
                        default -> "success";
                    };
                    batchWriter.insertPayment(sale.saleId(), sale.posSessionId(),
                            sale.paymentMethod(), sale.paymentAmount(), paymentTxnStatus, sale.paymentTime(),
                            sale.transactionRef(), null);
                    totalRowsWritten++;
                }

                // Sale inventory transactions
                for (var txn : sale.inventoryTransactions()) {
                    batchWriter.insertInventoryTransaction(txn.txnId(), sale.outletId(),
                            txn.itemId(), -txn.qtyUsed(), day, sale.paymentTime(),
                            "sale_usage", null);
                    batchWriter.insertSaleItemTransaction(txn.txnId(),
                            sale.saleId(), txn.productId(), txn.itemId());
                    totalRowsWritten += 2;
                }
            }
            recordSection("salesMs", salesStartedAt);

            // 13b. POS Session Reconciliations
            for (var recon : ctx.getDirtyReconciliations()) {
                batchWriter.insertPosReconciliation(recon.sessionId(), recon.reconciledByUserId(),
                        recon.reconciledAt(), recon.expectedTotal(), recon.actualTotal(),
                        recon.discrepancyTotal(), recon.note());
                totalRowsWritten++;
                for (var line : recon.lines()) {
                    batchWriter.insertPosReconciliationLine(recon.sessionId(),
                            line.paymentMethod(), line.expectedAmount(), line.actualAmount(),
                            line.discrepancyAmount());
                    totalRowsWritten++;
                }
                // Update POS session status from 'closed' to 'reconciled'
                batchWriter.updatePosSessionStatus(recon.sessionId(), "reconciled");
                totalRowsWritten++;
            }

            long payrollStartedAt = System.nanoTime();
            // 14. Payroll
            for (var payroll : ctx.getDirtyPayrolls()) {
                long persistedPeriodId = SimulatorRepository.ensurePayrollPeriod(conn, payroll.periodId(), payroll.regionId(),
                        payroll.periodName(), payroll.startDate(), payroll.endDate(), payroll.payDate());
                totalRowsWritten++;

                for (var entry : payroll.timesheets()) {
                    batchWriter.insertPayrollTimesheet(entry.timesheetId(),
                            persistedPeriodId, entry.userId(), entry.outletId(), entry.workDays(), entry.workHours(),
                            entry.overtimeHours(), entry.overtimeRate(), entry.lateCount(), entry.absentDays(),
                            entry.approvedByUserId());
                    batchWriter.insertPayroll(entry.payrollId(), entry.timesheetId(),
                            entry.currencyCode(), entry.baseSalary(), entry.netSalary());
                    totalRowsWritten += 2;
                }
            }
            recordSection("payrollMs", payrollStartedAt);

            // 15. Waste records
            for (var waste : ctx.getDirtyWasteRecords()) {
                batchWriter.insertInventoryTransaction(waste.txnId(), waste.outletId(),
                        waste.itemId(), -waste.qty(), day,
                        ctx.getClock().timestampAt(18, 0, ctx.getTimezoneForRegion(waste.regionCode())),
                        "waste_out", null, waste.approvedByUserId(), waste.reason());
                batchWriter.insertWasteRecord(waste.txnId(), waste.reason(), waste.approvedByUserId());
                totalRowsWritten += 2;
            }

            // 16. Supplier Invoices
            for (var inv : ctx.getDirtyInvoices()) {
                SimulatorRepository.insertSupplierInvoice(conn, inv.invoiceId(), inv.invoiceNumber(),
                        inv.supplierId(), inv.currencyCode(), inv.invoiceDate(), inv.dueDate(),
                        inv.subtotal(), inv.taxAmount(), inv.totalAmount(), inv.status(), inv.note());
                totalRowsWritten++;

                // Link invoice to goods receipt
                Long grId = ctx.lookupGoodsReceiptId(inv.receiptId());
                if (grId != null) {
                    SimulatorRepository.insertSupplierInvoiceReceipt(conn, inv.invoiceId(), grId);
                    totalRowsWritten++;
                }

                // Invoice line items
                for (var line : inv.lines()) {
                    Long goodsReceiptItemId = line.goodsReceiptItemId();
                    if (goodsReceiptItemId == null && line.itemId() != null) {
                        goodsReceiptItemId = ctx.lookupGoodsReceiptItemId(inv.receiptId(), line.itemId());
                    }
                    batchWriter.insertSupplierInvoiceItem(inv.invoiceId(),
                            line.lineNumber(), goodsReceiptItemId,
                            line.qtyInvoiced(), line.unitPrice(), line.taxAmount(), line.lineTotal(),
                            line.description(), line.taxPercent());
                    totalRowsWritten++;
                }
            }

            // 17. Supplier Payments
            for (var pmt : ctx.getDirtySupplierPayments()) {
                batchWriter.insertSupplierPayment(pmt.paymentId(), pmt.supplierId(),
                        pmt.currencyCode(), pmt.paymentMethod(), pmt.amount(), pmt.paymentTime(),
                        pmt.transactionRef(), pmt.note(), pmt.createdByUserId());
                batchWriter.insertSupplierPaymentAllocation(pmt.paymentId(),
                        pmt.invoiceId(), pmt.amount());
                totalRowsWritten += 2;
            }

            // 18. Expense Records
            for (var exp : ctx.getDirtyExpenses()) {
                batchWriter.insertExpenseRecord(exp.expenseId(), exp.outletId(),
                        exp.businessDate(), exp.currencyCode(), exp.amount(),
                        exp.sourceType(), exp.note(), exp.createdByUserId());
                totalRowsWritten++;
            }

            // 19. Goods Receipt inventory transactions (incoming stock)
            for (var grIn : ctx.getDirtyGoodsReceiptIns()) {
                batchWriter.insertInventoryTransaction(grIn.txnId(), grIn.outletId(),
                        grIn.itemId(), grIn.qty(), day,
                        ctx.getClock().timestampAt(9, 0,
                                ctx.getTimezoneForRegion(ctx.getConfig().startingRegion())),
                        "purchase_in", null);
                totalRowsWritten++;
            }

            long stockBalanceStartedAt = System.nanoTime();
            // 20. Stock Balance upserts (current state for changed items only)
            for (SimOutlet outlet : ctx.getActiveOutlets()) {
                for (Long itemId : ctx.getDirtyStockItems(outlet.getId())) {
                    SimItem stock = ctx.getOutletStock(outlet.getId(), itemId);
                    SimItem globalItem = ctx.getItems().get(itemId);
                    if (stock == null || globalItem == null) continue;
                    batchWriter.upsertStockBalance(outlet.getId(), itemId, stock.getCurrentStock(),
                            globalItem.getUnitCost(), day);
                    totalRowsWritten++;
                }
            }
            recordSection("stockBalanceMs", stockBalanceStartedAt);

            // 21. Stock Count Sessions + Lines
            for (var sc : ctx.getDirtyStockCounts()) {
                batchWriter.insertStockCountSession(sc.sessionId(),
                        sc.outletId(), sc.countDate(), "approved",
                        sc.countedByUserId(), sc.approvedByUserId(), sc.note());
                totalRowsWritten++;

                for (var line : sc.lines()) {
                    long lineId = ctx.getIdGen().nextId();
                    batchWriter.insertStockCountLine(lineId, sc.sessionId(),
                            line.itemId(), line.systemQty(), line.countedQty());
                    totalRowsWritten++;
                }
            }

            // 21. Item Categories (first day only)
            for (var catEntry : ctx.getDirtyItemCategories()) {
                SimulatorRepository.insertItemCategory(conn, catEntry.getKey(), catEntry.getValue());
                totalRowsWritten++;
            }

            // 22. Product Categories (first day only)
            for (var catEntry : ctx.getDirtyProductCategories()) {
                SimulatorRepository.insertProductCategory(conn, catEntry.getKey(), catEntry.getValue());
                totalRowsWritten++;
            }

            // 23. UOMs (first day only)
            for (var uomEntry : ctx.getDirtyUoms()) {
                SimulatorRepository.insertUom(conn, uomEntry.getKey(), uomEntry.getValue());
                totalRowsWritten++;
            }

            long workforceStartedAt = System.nanoTime();
            // 27. Work Shifts (daily employee shifts)
            for (var ws : ctx.getDirtyWorkShifts()) {
                batchWriter.insertWorkShift(ws.id(), ws.shiftId(), ws.userId(), ws.workDate(),
                        ws.scheduleStatus(), ws.attendanceStatus(), ws.approvalStatus(),
                        ws.actualStartTime(), ws.actualEndTime(),
                        ws.assignedByUserId(), ws.approvedByUserId(), ws.note());
                totalRowsWritten++;
            }

            // 27. Promotion Scopes
            for (var ps : ctx.getDirtyPromotionScopes()) {
                SimulatorRepository.insertPromotionScope(conn, ps.promotionId(), ps.outletId());
                totalRowsWritten++;
            }

            // 29. Sale Item Promotions
            for (var sip : ctx.getDirtySaleItemPromotions()) {
                batchWriter.insertSaleItemPromotion(sip.saleId(), sip.productId(), sip.promotionId());
                totalRowsWritten++;
            }

            // Expense subtype tables reference expense_record, which is batched earlier.
            batchWriter.flush();

            // 29. Expense Subtypes (operating, payroll, inventory_purchase, other)
            for (var sub : ctx.getDirtyExpenseSubtypes()) {
                switch (sub.subtype()) {
                    case "operating" -> {
                        SimulatorRepository.insertExpenseOperating(conn, sub.expenseRecordId(),
                                sub.description() != null ? sub.description() : "Operating expense");
                        totalRowsWritten++;
                    }
                    case "payroll" -> {
                        if (sub.linkedId() != null) {
                            SimulatorRepository.insertExpensePayroll(conn, sub.expenseRecordId(), sub.linkedId());
                            totalRowsWritten++;
                        }
                    }
                    case "inventory_purchase" -> {
                        if (sub.linkedId() != null) {
                            // Need goods_receipt_id — look up from stored GR mapping
                            Long grId = ctx.lookupGoodsReceiptId(sub.linkedId()); // PO ID → GR ID
                            if (grId != null) {
                                SimulatorRepository.insertExpenseInventoryPurchase(conn, sub.expenseRecordId(), grId);
                                totalRowsWritten++;
                            }
                        }
                    }
                    case "other" -> {
                        SimulatorRepository.insertExpenseOther(conn, sub.expenseRecordId(),
                                sub.description() != null ? sub.description() : "Miscellaneous expense");
                        totalRowsWritten++;
                    }
                }
            }

            // 31. Auth Sessions
            for (var session : ctx.getDirtyAuthSessions()) {
                batchWriter.insertAuthSession(session.sessionId(), session.userId(),
                        session.issuedAt(), session.expiresAt(), session.userAgent(), session.clientIp());
                totalRowsWritten++;
            }
            recordSection("workforceMs", workforceStartedAt);

            // 31. Audit Logs
            for (var audit : ctx.getDirtyAuditLogs()) {
                SimulatorRepository.insertAuditLog(conn, audit.id(), audit.actorUserId(),
                        audit.action(), audit.entityName(), audit.entityId(), audit.reason());
                totalRowsWritten++;
            }

            // 33. Inventory Adjustments (need parent inventory_transaction first)
            for (var adj : ctx.getDirtyInventoryAdjustments()) {
                // Create parent inventory_transaction (type=adjustment)
                var txnTime = ctx.getClock().timestampAt(10, 0,
                        ctx.getTimezoneForRegion(ctx.getConfig().startingRegion()));
                String txnType = adj.quantity() > 0 ? "stock_adjustment_in" : "stock_adjustment_out";
                batchWriter.insertInventoryTransaction(adj.txnId(), adj.outletId(),
                        adj.itemId(), adj.quantity(), day, txnTime, txnType, null);
                totalRowsWritten++;
                // Then create the adjustment detail
                batchWriter.insertInventoryAdjustment(adj.txnId(),
                        adj.stockCountLineId(), adj.reason(), adj.approvedByUserId());
                totalRowsWritten++;
            }

            long manufacturingStartedAt = System.nanoTime();
            // 34. Manufacturing Batches + Transactions
            for (var mfg : ctx.getDirtyManufacturing()) {
                batchWriter.insertManufacturingBatch(mfg.batchId(), mfg.outletId(),
                        mfg.refCode(), mfg.businessDate(), mfg.note(), mfg.createdByUserId());
                totalRowsWritten++;

                var mfgTxnTime = ctx.getClock().timestampAt(8, 0,
                        ctx.getTimezoneForRegion(ctx.getConfig().startingRegion()));

                // Persist input transactions (consume ingredients → manufacture_out)
                for (var input : mfg.inputs()) {
                    batchWriter.insertInventoryTransaction(input.txnId(), mfg.outletId(),
                            input.itemId(), -input.qty(), mfg.businessDate(), mfgTxnTime,
                            "manufacture_out", input.unitCost());
                    totalRowsWritten++;
                    batchWriter.insertManufacturingTransaction(input.txnId(), mfg.batchId());
                    totalRowsWritten++;
                }
                // Persist output transaction (produce finished good → manufacture_in)
                var output = mfg.output();
                batchWriter.insertInventoryTransaction(output.txnId(), mfg.outletId(),
                        output.itemId(), output.qty(), mfg.businessDate(), mfgTxnTime,
                        "manufacture_in", output.unitCost());
                totalRowsWritten++;
                batchWriter.insertManufacturingTransaction(output.txnId(), mfg.batchId());
                totalRowsWritten++;
            }
            recordSection("manufacturingMs", manufacturingStartedAt);

            // 34. Tax Rates (first day: seed 10% VAT for all products×regions)
            if (ctx.getDirtyProducts().size() > 0 && ctx.getDirtyRegions().size() > 0) {
                var taxPercent = new java.math.BigDecimal("10.00");
                for (String regionCode : ctx.getDirtyRegions()) {
                    Long regionId = ctx.getRegionId(regionCode);
                    if (regionId == null) continue;
                    for (var product : ctx.getDirtyProducts()) {
                        SimulatorRepository.insertTaxRate(conn, regionId, product.id(), taxPercent,
                                ctx.getConfig().startDate());
                        totalRowsWritten++;
                    }
                }
            }

            batchWriter.flush();
            conn.commit();
            ctx.clearDirtyState();
            totalPersistMillis += (System.nanoTime() - persistStartedAt) / 1_000_000L;

        } catch (SQLException e) {
            conn.rollback();
            throw e;
        } finally {
            conn.setAutoCommit(true);
        }
    }

    public long getTotalRowsWritten() { return totalRowsWritten; }
    public long getTotalPersistMillis() { return totalPersistMillis; }
    public Map<String, Long> getSectionTimingsMillis() { return Map.copyOf(sectionTimingsMillis); }

    // --- Helpers ---

    private void updateUserStatus(Connection conn, SimEmployee emp) throws SQLException {
        String sql = """
            UPDATE core.app_user SET status = ? WHERE id = ?
            """;
        try (var ps = conn.prepareStatement(sql)) {
            ps.setObject(1, emp.getUserStatus(), java.sql.Types.OTHER);
            ps.setLong(2, emp.getUserId());
            ps.executeUpdate();
        }

        String contractSql = """
            UPDATE core.employee_contract SET status = ?, end_date = ? WHERE id = ?
            """;
        try (var ps = conn.prepareStatement(contractSql)) {
            ps.setObject(1, emp.getContractStatus(), java.sql.Types.OTHER);
            ps.setObject(2, emp.getTerminationDate() != null
                    ? java.sql.Date.valueOf(emp.getTerminationDate()) : null);
            ps.setLong(3, emp.getContractId());
            ps.executeUpdate();
        }
    }

    private void recordSection(String name, long startedAtNanos) {
        sectionTimingsMillis.merge(name, (System.nanoTime() - startedAtNanos) / 1_000_000L, Long::sum);
    }

    private Long findManagerAtOutlet(SimulationContext ctx, long outletId) {
        return ctx.getActiveEmployeesAtOutlet(outletId).stream()
                .filter(e -> "outlet_manager".equals(e.getRoleCode()))
                .map(SimEmployee::getUserId)
                .findFirst().orElse(null);
    }

    private SimulationConfig.RegionConfig findRegionConfig(SimulationContext ctx, String code) {
        if (ctx.getConfig().regions() == null) return null;
        for (SimulationConfig.RegionConfig r : ctx.getConfig().regions()) {
            if (r.code().equals(code)) return r;
            if (r.subregions() != null) {
                for (var sub : r.subregions()) {
                    if (sub.code().equals(code)) return r;
                }
            }
        }
        return null;
    }

    private Long lookupExistingRegionId(Connection conn, String code) throws SQLException {
        String sql = "SELECT id FROM core.region WHERE code = ?";
        try (var ps = conn.prepareStatement(sql)) {
            ps.setString(1, code);
            try (var rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong("id") : null;
            }
        }
    }
}
