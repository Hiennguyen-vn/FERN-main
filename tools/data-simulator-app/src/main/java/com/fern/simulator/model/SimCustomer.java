package com.fern.simulator.model;

import java.time.LocalDate;

/**
 * Loyalty customer (crm.customer). PDPL-aware: soft-delete via deletedAt.
 */
public class SimCustomer {
    private final long id;
    private final String phone;
    private final String fullName;
    private final LocalDate birthday;
    private final boolean consentMarketing;
    private final LocalDate registeredOn;
    private LocalDate phoneVerifiedOn;
    private int pointsBalance;
    private LocalDate deletedOn;

    public SimCustomer(long id, String phone, String fullName, LocalDate birthday,
                       boolean consentMarketing, LocalDate registeredOn) {
        this.id = id;
        this.phone = phone;
        this.fullName = fullName;
        this.birthday = birthday;
        this.consentMarketing = consentMarketing;
        this.registeredOn = registeredOn;
        this.pointsBalance = 0;
    }

    public long getId() { return id; }
    public String getPhone() { return phone; }
    public String getFullName() { return fullName; }
    public LocalDate getBirthday() { return birthday; }
    public boolean isConsentMarketing() { return consentMarketing; }
    public LocalDate getRegisteredOn() { return registeredOn; }
    public LocalDate getPhoneVerifiedOn() { return phoneVerifiedOn; }
    public int getPointsBalance() { return pointsBalance; }
    public LocalDate getDeletedOn() { return deletedOn; }

    public void verifyPhone(LocalDate on) { this.phoneVerifiedOn = on; }
    public void softDelete(LocalDate on) { this.deletedOn = on; }
    public boolean isActive() { return deletedOn == null; }

    public int credit(int delta) {
        this.pointsBalance += delta;
        return this.pointsBalance;
    }

    public int debit(int delta) {
        int d = Math.min(delta, this.pointsBalance);
        this.pointsBalance -= d;
        return this.pointsBalance;
    }
}
