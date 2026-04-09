package com.fern.simulator.model;

import java.time.LocalDate;

/**
 * Tracks the state of a simulated employee across the simulation timeline.
 */
public class SimEmployee {
    private final long userId;
    private final long contractId;
    private final String employeeCode;
    private final String username;
    private final String fullName;
    private final String gender;
    private final long outletId;
    private final String regionCode;
    private final String roleCode; // nullable — no role for generic employees
    private String userStatus = "active";
    private String contractStatus = "active";
    private final LocalDate hireDate;
    private LocalDate terminationDate;
    private LocalDate scheduledReplacementDate; // for lag tracking

    private final long baseSalary;
    private final String currencyCode;
    private final String employmentType; // full_time, part_time, contract
    private final String salaryType;     // monthly, hourly
    private double attendanceReliability;
    private double fatigueScore;
    private double disciplineScore;

    public SimEmployee(long userId, long contractId, String employeeCode, String username,
                       String fullName, String gender, long outletId, String regionCode,
                       String roleCode, LocalDate hireDate, long baseSalary,
                       String currencyCode, String employmentType, String salaryType) {
        this(userId, contractId, employeeCode, username, fullName, gender, outletId, regionCode, roleCode,
                hireDate, baseSalary, currencyCode, employmentType, salaryType, 0.94, 0.0, 0.75);
    }

    public SimEmployee(long userId, long contractId, String employeeCode, String username,
                       String fullName, String gender, long outletId, String regionCode,
                       String roleCode, LocalDate hireDate, long baseSalary,
                       String currencyCode, String employmentType, String salaryType,
                       double attendanceReliability, double fatigueScore, double disciplineScore) {
        this.userId = userId;
        this.contractId = contractId;
        this.employeeCode = employeeCode;
        this.username = username;
        this.fullName = fullName;
        this.gender = gender;
        this.outletId = outletId;
        this.regionCode = regionCode;
        this.roleCode = roleCode;
        this.hireDate = hireDate;
        this.baseSalary = baseSalary;
        this.currencyCode = currencyCode;
        this.employmentType = employmentType;
        this.salaryType = salaryType;
        this.attendanceReliability = attendanceReliability;
        this.fatigueScore = fatigueScore;
        this.disciplineScore = disciplineScore;
    }

    // --- Getters ---
    public long getUserId() { return userId; }
    public long getContractId() { return contractId; }
    public String getEmployeeCode() { return employeeCode; }
    public String getUsername() { return username; }
    public String getFullName() { return fullName; }
    public String getGender() { return gender; }
    public long getOutletId() { return outletId; }
    public String getRegionCode() { return regionCode; }
    public String getRoleCode() { return roleCode; }
    public String getUserStatus() { return userStatus; }
    public String getContractStatus() { return contractStatus; }
    public LocalDate getHireDate() { return hireDate; }
    public LocalDate getTerminationDate() { return terminationDate; }
    public LocalDate getScheduledReplacementDate() { return scheduledReplacementDate; }
    public long getBaseSalary() { return baseSalary; }
    public String getCurrencyCode() { return currencyCode; }
    public String getEmploymentType() { return employmentType; }
    public String getSalaryType() { return salaryType; }
    public double getAttendanceReliability() { return attendanceReliability; }
    public double getFatigueScore() { return fatigueScore; }
    public double getDisciplineScore() { return disciplineScore; }

    // --- Mutators ---
    public void setUserStatus(String status) { this.userStatus = status; }
    public void setContractStatus(String status) { this.contractStatus = status; }
    public void setTerminationDate(LocalDate date) { this.terminationDate = date; }
    public void setScheduledReplacementDate(LocalDate date) { this.scheduledReplacementDate = date; }
    public void setAttendanceReliability(double attendanceReliability) { this.attendanceReliability = attendanceReliability; }
    public void setFatigueScore(double fatigueScore) { this.fatigueScore = fatigueScore; }
    public void setDisciplineScore(double disciplineScore) { this.disciplineScore = disciplineScore; }

    public boolean isActive() { return "active".equals(userStatus); }
    public boolean isDeparted() { return "inactive".equals(userStatus) || "suspended".equals(userStatus); }
    public boolean hasRole() { return roleCode != null && !"employee_no_role".equals(roleCode); }
}
