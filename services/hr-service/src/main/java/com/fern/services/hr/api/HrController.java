package com.fern.services.hr.api;

import com.dorabets.common.spring.web.PagedResult;
import com.fern.services.hr.application.EmployeeContractService;
import com.fern.services.hr.application.ShiftService;
import com.fern.services.hr.application.WorkShiftService;
import com.fern.services.hr.infrastructure.WorkShiftRepository;
import jakarta.validation.Valid;
import java.time.LocalDate;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/hr")
public class HrController {

  private final ShiftService shiftService;
  private final WorkShiftService workShiftService;
  private final EmployeeContractService contractService;

  public HrController(
      ShiftService shiftService,
      WorkShiftService workShiftService,
      EmployeeContractService contractService
  ) {
    this.shiftService = shiftService;
    this.workShiftService = workShiftService;
    this.contractService = contractService;
  }

  @PostMapping("/shifts")
  public ResponseEntity<ShiftDto> createShift(@Valid @RequestBody ShiftDto.Create request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(shiftService.createShift(request));
  }

  @GetMapping("/shifts/{shiftId}")
  public ShiftDto getShift(@PathVariable long shiftId) {
    return shiftService.getShift(shiftId);
  }

  @GetMapping("/shifts")
  public PagedResult<ShiftDto> listShifts(
      @RequestParam(required = false) Long outletId,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return shiftService.listShiftsByOutlet(outletId, q, sortBy, sortDir, limit, offset);
  }

  @GetMapping("/shifts/outlet/{outletId}/all")
  public List<ShiftDto> listAllShiftsByOutlet(@PathVariable long outletId) {
    return shiftService.listAllShiftsByOutlet(outletId);
  }

  @PutMapping("/shifts/{shiftId}")
  public ShiftDto updateShift(@PathVariable long shiftId, @Valid @RequestBody ShiftDto.Update request) {
    return shiftService.updateShift(shiftId, request);
  }

  @DeleteMapping("/shifts/{shiftId}")
  public ResponseEntity<Void> deleteShift(@PathVariable long shiftId) {
    shiftService.deleteShift(shiftId);
    return ResponseEntity.noContent().build();
  }

  @GetMapping("/shifts/{shiftId}/roles")
  public List<ShiftDto.RoleRequirement> getShiftRoles(@PathVariable long shiftId) {
    return shiftService.getRoleRequirements(shiftId);
  }

  @PutMapping("/shifts/{shiftId}/roles")
  public List<ShiftDto.RoleRequirement> setShiftRoles(
      @PathVariable long shiftId,
      @Valid @RequestBody List<ShiftDto.RoleRequirement> roles
  ) {
    return shiftService.setRoleRequirements(shiftId, roles);
  }

  @PostMapping("/work-shifts")
  public ResponseEntity<WorkShiftDto> createWorkShift(@Valid @RequestBody WorkShiftDto.Create request) {
    return ResponseEntity.status(HttpStatus.CREATED).body(workShiftService.createWorkShift(request));
  }

  @GetMapping("/work-shifts/{workShiftId}")
  public WorkShiftDto getWorkShift(@PathVariable long workShiftId) {
    return workShiftService.getWorkShift(workShiftId);
  }

  @GetMapping("/work-shifts")
  public PagedResult<WorkShiftDto> listWorkShifts(
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String scheduleStatus,
      @RequestParam(required = false) String attendanceStatus,
      @RequestParam(required = false) String approvalStatus,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return workShiftService.listWorkShifts(
        userId,
        outletId,
        scheduleStatus,
        attendanceStatus,
        approvalStatus,
        startDate,
        endDate,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @GetMapping("/time-off")
  public PagedResult<WorkShiftDto> listTimeOffRequests(
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String approvalStatus,
      @RequestParam(required = false) LocalDate startDate,
      @RequestParam(required = false) LocalDate endDate,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return workShiftService.listTimeOffRequests(
        userId,
        outletId,
        approvalStatus,
        startDate,
        endDate,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @GetMapping("/outlet/{outletId}/staff")
  public List<WorkShiftRepository.StaffSummary> listOutletStaff(@PathVariable long outletId) {
    return workShiftService.listOutletStaff(outletId);
  }

  @GetMapping("/work-shifts/outlet/{outletId}/date/{date}")
  public List<WorkShiftDto> listWorkShiftsByOutletAndDate(
      @PathVariable long outletId,
      @PathVariable LocalDate date
  ) {
    return workShiftService.listWorkShiftsByOutlet(outletId, date);
  }

  @PutMapping("/work-shifts/{workShiftId}/attendance")
  public WorkShiftDto updateAttendance(
      @PathVariable long workShiftId,
      @Valid @RequestBody WorkShiftDto.AttendanceUpdate request
  ) {
    return workShiftService.updateAttendance(workShiftId, request);
  }

  @PostMapping("/work-shifts/{workShiftId}/approve")
  public WorkShiftDto approveWorkShift(@PathVariable long workShiftId) {
    return workShiftService.approveWorkShift(workShiftId);
  }

  @PostMapping("/work-shifts/{workShiftId}/reject")
  public WorkShiftDto rejectWorkShift(
      @PathVariable long workShiftId,
      @RequestBody(required = false) WorkShiftDto.ApprovalDecision request
  ) {
    return workShiftService.rejectWorkShift(workShiftId, request == null ? null : request.reason());
  }

  @PostMapping("/contracts")
  public ResponseEntity<EmployeeContractDto> createContract(
      @Valid @RequestBody EmployeeContractDto.Create request
  ) {
    return ResponseEntity.status(HttpStatus.CREATED).body(contractService.createContract(request));
  }

  @GetMapping("/contracts/{contractId}")
  public EmployeeContractDto getContract(@PathVariable long contractId) {
    return contractService.getContract(contractId);
  }

  @GetMapping("/contracts/user/{userId}")
  public List<EmployeeContractDto> listContractsByUser(@PathVariable long userId) {
    return contractService.listContractsByUser(userId);
  }

  @GetMapping("/contracts/active")
  public List<EmployeeContractDto> listActiveContracts() {
    return contractService.listActiveContracts();
  }

  @GetMapping("/contracts")
  public PagedResult<EmployeeContractDto> listContracts(
      @RequestParam(required = false) Long userId,
      @RequestParam(required = false) Long outletId,
      @RequestParam(required = false) String status,
      @RequestParam(required = false) LocalDate startDateFrom,
      @RequestParam(required = false) LocalDate startDateTo,
      @RequestParam(required = false) LocalDate endDateFrom,
      @RequestParam(required = false) LocalDate endDateTo,
      @RequestParam(name = "q", required = false) String q,
      @RequestParam(required = false) String sortBy,
      @RequestParam(required = false) String sortDir,
      @RequestParam(required = false) Integer limit,
      @RequestParam(required = false) Integer offset
  ) {
    return contractService.listContracts(
        userId,
        outletId,
        status,
        startDateFrom,
        startDateTo,
        endDateFrom,
        endDateTo,
        q,
        sortBy,
        sortDir,
        limit,
        offset
    );
  }

  @GetMapping("/contracts/user/{userId}/latest")
  public EmployeeContractDto getLatestActiveContract(@PathVariable long userId) {
    return contractService.getLatestActiveContract(userId);
  }

  @PutMapping("/contracts/{contractId}")
  public EmployeeContractDto updateContract(
      @PathVariable long contractId,
      @Valid @RequestBody EmployeeContractDto.Update request
  ) {
    return contractService.updateContract(contractId, request);
  }

  @PostMapping("/contracts/{contractId}/terminate")
  public EmployeeContractDto terminateContract(
      @PathVariable long contractId,
      @RequestBody(required = false) EmployeeContractDto.Terminate request
  ) {
    return contractService.terminateContract(contractId, request == null ? null : request.endDate());
  }
}
