package com.fern.services.auth.spring.infrastructure;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.postgresql.ds.PGSimpleDataSource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Integration tests for OrgSyncRepository using a real PostgreSQL container.
 *
 * Fixture layout (shared, reset per test):
 *
 *   region VN (id=1)
 *   └── outlet HCM-1 (id=101)
 *   └── outlet HCM-2 (id=102)
 *   region DN (id=2)
 *   └── outlet DN-1  (id=201)
 *
 *   userFull   (id=10) — admin on HCM-1 AND HCM-2  (covers ALL 2 outlets in VN)
 *   userSubset (id=11) — admin on HCM-1 ONLY        (covers 1/2 outlets in VN)
 *   userSuper  (id=12) — superadmin on HCM-1 AND HCM-2
 *   userDN     (id=13) — admin on DN-1 only (sole outlet in DN → qualifies as "full" for DN)
 *
 * "Phủ đủ" rule: region-scoped fan-out only for users covering ALL active outlets in region.
 * userSubset must NEVER receive new rows via fan-out.
 */
@Testcontainers
class OrgSyncRepositoryTest {

    @Container
    static final PostgreSQLContainer<?> PG =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withInitScript("test-schema.sql");

    private OrgSyncRepository repo;

    @BeforeEach
    void setUp() throws Exception {
        repo = new OrgSyncRepository(buildDs());
        resetFixtures();
    }

    // -----------------------------------------------------------------------
    // Handler 1: fanOutNewOutlet
    // -----------------------------------------------------------------------

    @Test
    void fanOutNewOutlet_superadminReceivesRow() throws Exception {
        // outlet HCM-3 (id=103) added to region VN (id=1)
        insertOutlet(103L, 1L, "HCM-3");

        Set<Long> evicted = repo.fanOutNewOutlet(103L, 1L);

        assertThat(hasUserRole(12L, "superadmin", 103L)).isTrue();
        assertThat(evicted).contains(12L);
    }

    @Test
    void fanOutNewOutlet_fullRegionAdminReceivesRow() throws Exception {
        insertOutlet(103L, 1L, "HCM-3");

        Set<Long> evicted = repo.fanOutNewOutlet(103L, 1L);

        // userFull covers HCM-1 + HCM-2 (all 2 existing) → qualifies
        assertThat(hasUserRole(10L, "admin", 103L)).isTrue();
        assertThat(evicted).contains(10L);
    }

    @Test
    void fanOutNewOutlet_subsetAdminDoesNotReceiveRow() throws Exception {
        insertOutlet(103L, 1L, "HCM-3");

        repo.fanOutNewOutlet(103L, 1L);

        // userSubset covers only HCM-1 → does NOT qualify
        assertThat(hasUserRole(11L, "admin", 103L)).isFalse();
    }

    @Test
    void fanOutNewOutlet_otherRegionUserDoesNotReceiveRow() throws Exception {
        insertOutlet(103L, 1L, "HCM-3");

        repo.fanOutNewOutlet(103L, 1L);

        // userDN is admin in DN region, not VN → must not get HCM-3 row
        assertThat(hasUserRole(13L, "admin", 103L)).isFalse();
    }

    @Test
    void fanOutNewOutlet_idempotent() throws Exception {
        insertOutlet(103L, 1L, "HCM-3");

        repo.fanOutNewOutlet(103L, 1L);
        // Second call must not throw and must not duplicate rows
        Set<Long> evicted2 = repo.fanOutNewOutlet(103L, 1L);

        assertThat(countUserRoles(10L, "admin", 103L)).isEqualTo(1);
        assertThat(evicted2).contains(10L);
    }

    // -----------------------------------------------------------------------
    // Handler 2: reSyncOutletRegion
    // -----------------------------------------------------------------------

    /**
     * Simulate HCM-2 moving from region VN (id=1) to region DN (id=2).
     * Before move: userFull has admin on HCM-1 + HCM-2; userDN has admin on DN-1.
     * After re-sync:
     *   - userFull should LOSE HCM-2 (no longer in VN, and has no role in DN yet)
     *   - userDN should GAIN HCM-2 (covers all of DN: DN-1 only; now HCM-2 added to DN)
     */
    @Test
    void reSyncOutletRegion_staleRowsRemovedForOldRegionUser() throws Exception {
        // Before: userFull has admin on HCM-2
        assertThat(hasUserRole(10L, "admin", 102L)).isTrue();

        repo.reSyncOutletRegion(102L, 2L);

        // userFull has no role in DN → row for HCM-2 should be gone
        assertThat(hasUserRole(10L, "admin", 102L)).isFalse();
    }

    @Test
    void reSyncOutletRegion_newRegionFullUserGainsRow() throws Exception {
        // userDN covers all of DN (DN-1 is the only outlet) → qualifies
        repo.reSyncOutletRegion(102L, 2L);

        assertThat(hasUserRole(13L, "admin", 102L)).isTrue();
    }

    @Test
    void reSyncOutletRegion_subsetAdminInNewRegionDoesNotGainRow() throws Exception {
        // Add a second outlet to DN so userDN becomes a subset admin
        insertOutlet(202L, 2L, "DN-2");
        // userDN still only has admin on DN-1 → 1 of 2 → subset → must NOT get HCM-2

        repo.reSyncOutletRegion(102L, 2L);

        assertThat(hasUserRole(13L, "admin", 102L)).isFalse();
    }

    @Test
    void reSyncOutletRegion_affectedUsersReturnedForEviction() throws Exception {
        Set<Long> evicted = repo.reSyncOutletRegion(102L, 2L);

        // userFull had row before (preUsers) → must be in eviction set
        assertThat(evicted).contains(10L);
        // userDN received row (postUsers) → must be in eviction set
        assertThat(evicted).contains(13L);
    }

    @Test
    void reSyncOutletRegion_superadminRowsUntouched() throws Exception {
        // Superadmin rows should not be touched by reSyncOutletRegion
        assertThat(hasUserRole(12L, "superadmin", 102L)).isTrue();

        repo.reSyncOutletRegion(102L, 2L);

        assertThat(hasUserRole(12L, "superadmin", 102L)).isTrue();
    }

    // -----------------------------------------------------------------------
    // Handler 3: collectUsersInRegionSubtree
    // -----------------------------------------------------------------------

    @Test
    void collectUsersInRegionSubtree_returnsUsersInDirectRegion() {
        // VN region (id=1): HCM-1, HCM-2 → userFull(10), userSubset(11), userSuper(12) have rows
        Set<Long> users = repo.collectUsersInRegionSubtree(1L);

        assertThat(users).contains(10L, 11L, 12L);
        assertThat(users).doesNotContain(13L);
    }

    @Test
    void collectUsersInRegionSubtree_includesChildRegionUsers() throws Exception {
        // Create child region VN-HCM (id=3) under VN (id=1), with outlet HCM-3 (id=103)
        insertRegion(3L, "VN-HCM", 1L);
        insertOutlet(103L, 3L, "HCM-3");
        insertUser(14L, "userChild");
        insertRole("admin");
        insertUserRole(14L, "admin", 103L);

        Set<Long> usersForVN = repo.collectUsersInRegionSubtree(1L);

        // subtree of VN includes VN-HCM → userChild must be included
        assertThat(usersForVN).contains(14L);
        // direct VN users still included
        assertThat(usersForVN).contains(10L, 11L, 12L);
    }

    @Test
    void collectUsersInRegionSubtree_doesNotReturnUsersOutsideSubtree() {
        // DN (id=2) users must not appear when querying subtree of VN (id=1)
        Set<Long> usersForVN = repo.collectUsersInRegionSubtree(1L);

        assertThat(usersForVN).doesNotContain(13L);
    }

    @Test
    void collectUsersInRegionSubtree_neverModifiesUserRoleTable() throws Exception {
        long countBefore = countAllUserRoles();
        repo.collectUsersInRegionSubtree(1L);
        long countAfter = countAllUserRoles();

        assertThat(countAfter).isEqualTo(countBefore);
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    private void resetFixtures() throws Exception {
        try (Connection conn = buildDs().getConnection()) {
            conn.setAutoCommit(false);
            try (var st = conn.createStatement()) {
                st.execute("DELETE FROM core.user_role");
                st.execute("DELETE FROM core.app_user");
                st.execute("DELETE FROM core.outlet");
                st.execute("DELETE FROM core.region");
                st.execute("DELETE FROM core.role");
            }

            // Roles
            exec(conn, "INSERT INTO core.role(code,name) VALUES(?,?) ON CONFLICT DO NOTHING",
                    "superadmin", "Superadmin");
            exec(conn, "INSERT INTO core.role(code,name) VALUES(?,?) ON CONFLICT DO NOTHING",
                    "admin", "Admin");

            // Regions
            exec(conn, "INSERT INTO core.region(id,code,name) VALUES(?,?,?)", 1L, "VN", "Vietnam");
            exec(conn, "INSERT INTO core.region(id,code,name) VALUES(?,?,?)", 2L, "DN", "Da Nang");

            // Outlets
            exec(conn, "INSERT INTO core.outlet(id,region_id,code,name) VALUES(?,?,?,?)",
                    101L, 1L, "HCM-1", "HCM Branch 1");
            exec(conn, "INSERT INTO core.outlet(id,region_id,code,name) VALUES(?,?,?,?)",
                    102L, 1L, "HCM-2", "HCM Branch 2");
            exec(conn, "INSERT INTO core.outlet(id,region_id,code,name) VALUES(?,?,?,?)",
                    201L, 2L, "DN-1", "Da Nang Branch 1");

            // Users
            exec(conn, "INSERT INTO core.app_user(id,username,full_name) VALUES(?,?,?)",
                    10L, "userFull", "Full Admin");
            exec(conn, "INSERT INTO core.app_user(id,username,full_name) VALUES(?,?,?)",
                    11L, "userSubset", "Subset Admin");
            exec(conn, "INSERT INTO core.app_user(id,username,full_name) VALUES(?,?,?)",
                    12L, "userSuper", "Super Admin");
            exec(conn, "INSERT INTO core.app_user(id,username,full_name) VALUES(?,?,?)",
                    13L, "userDN", "DN Admin");

            // user_role: userFull → admin on HCM-1 + HCM-2
            exec(conn, "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?)",
                    10L, "admin", 101L);
            exec(conn, "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?)",
                    10L, "admin", 102L);

            // user_role: userSubset → admin on HCM-1 ONLY
            exec(conn, "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?)",
                    11L, "admin", 101L);

            // user_role: userSuper → superadmin on HCM-1 + HCM-2
            exec(conn, "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?)",
                    12L, "superadmin", 101L);
            exec(conn, "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?)",
                    12L, "superadmin", 102L);

            // user_role: userDN → admin on DN-1 only (sole outlet → qualifies as full for DN)
            exec(conn, "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?)",
                    13L, "admin", 201L);

            conn.commit();
        }
    }

    private void insertOutlet(long id, long regionId, String code) throws Exception {
        PGSimpleDataSource ds = buildDs();
        try (Connection conn = ds.getConnection()) {
            exec(conn,
                    "INSERT INTO core.outlet(id,region_id,code,name) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
                    id, regionId, code, code + " Branch");
        }
    }

    private void insertRegion(long id, String code, long parentId) throws Exception {
        PGSimpleDataSource ds = buildDs();
        try (Connection conn = ds.getConnection()) {
            exec(conn,
                    "INSERT INTO core.region(id,code,name,parent_region_id) VALUES(?,?,?,?) ON CONFLICT DO NOTHING",
                    id, code, code, parentId);
        }
    }

    private void insertUser(long id, String username) throws Exception {
        PGSimpleDataSource ds = buildDs();
        try (Connection conn = ds.getConnection()) {
            exec(conn,
                    "INSERT INTO core.app_user(id,username,full_name) VALUES(?,?,?) ON CONFLICT DO NOTHING",
                    id, username, username);
        }
    }

    private void insertRole(String code) throws Exception {
        PGSimpleDataSource ds = buildDs();
        try (Connection conn = ds.getConnection()) {
            exec(conn,
                    "INSERT INTO core.role(code,name) VALUES(?,?) ON CONFLICT DO NOTHING",
                    code, code);
        }
    }

    private void insertUserRole(long userId, String roleCode, long outletId) throws Exception {
        PGSimpleDataSource ds = buildDs();
        try (Connection conn = ds.getConnection()) {
            exec(conn,
                    "INSERT INTO core.user_role(user_id,role_code,outlet_id) VALUES(?,?,?) ON CONFLICT DO NOTHING",
                    userId, roleCode, outletId);
        }
    }

    private boolean hasUserRole(long userId, String roleCode, long outletId) throws Exception {
        String sql = "SELECT 1 FROM core.user_role WHERE user_id=? AND role_code=? AND outlet_id=?";
        try (Connection conn = buildDs().getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, userId);
            ps.setString(2, roleCode);
            ps.setLong(3, outletId);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    private int countUserRoles(long userId, String roleCode, long outletId) throws Exception {
        String sql = "SELECT COUNT(*) FROM core.user_role WHERE user_id=? AND role_code=? AND outlet_id=?";
        try (Connection conn = buildDs().getConnection();
             PreparedStatement ps = conn.prepareStatement(sql)) {
            ps.setLong(1, userId);
            ps.setString(2, roleCode);
            ps.setLong(3, outletId);
            try (ResultSet rs = ps.executeQuery()) {
                rs.next();
                return rs.getInt(1);
            }
        }
    }

    private long countAllUserRoles() throws Exception {
        try (Connection conn = buildDs().getConnection();
             PreparedStatement ps = conn.prepareStatement("SELECT COUNT(*) FROM core.user_role");
             ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private PGSimpleDataSource buildDs() {
        PGSimpleDataSource ds = new PGSimpleDataSource();
        ds.setUrl(PG.getJdbcUrl());
        ds.setUser(PG.getUsername());
        ds.setPassword(PG.getPassword());
        return ds;
    }

    private void exec(Connection conn, String sql, Object... params) throws SQLException {
        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            for (int i = 0; i < params.length; i++) {
                Object p = params[i];
                if (p instanceof Long l) ps.setLong(i + 1, l);
                else if (p instanceof String s) ps.setString(i + 1, s);
                else ps.setObject(i + 1, p);
            }
            ps.executeUpdate();
        }
    }
}
