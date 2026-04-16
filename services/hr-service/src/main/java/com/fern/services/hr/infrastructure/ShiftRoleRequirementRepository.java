package com.fern.services.hr.infrastructure;

import com.dorabets.common.repository.BaseRepository;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.util.List;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class ShiftRoleRequirementRepository extends BaseRepository {

  public ShiftRoleRequirementRepository(DataSource dataSource) {
    super(dataSource);
  }

  public record RoleRequirementRecord(
      long id,
      long shiftId,
      String workRole,
      int requiredCount,
      boolean isOptional,
      Instant createdAt
  ) {
  }

  public List<RoleRequirementRecord> findByShiftId(long shiftId) {
    return queryList(
        """
        SELECT id, shift_id, work_role, required_count, is_optional, created_at
        FROM core.shift_role_requirement
        WHERE shift_id = ?
        ORDER BY work_role
        """,
        this::mapRecord,
        shiftId
    );
  }

  public List<RoleRequirementRecord> findByShiftIds(List<Long> shiftIds) {
    if (shiftIds.isEmpty()) {
      return List.of();
    }
    StringBuilder sql = new StringBuilder(
        """
        SELECT id, shift_id, work_role, required_count, is_optional, created_at
        FROM core.shift_role_requirement
        WHERE shift_id IN (
        """
    );
    for (int i = 0; i < shiftIds.size(); i++) {
      if (i > 0) sql.append(", ");
      sql.append('?');
    }
    sql.append(") ORDER BY shift_id, work_role");
    return queryList(sql.toString(), this::mapRecord, shiftIds.toArray());
  }

  public void deleteByShiftId(long shiftId) {
    execute("DELETE FROM core.shift_role_requirement WHERE shift_id = ?", shiftId);
  }

  public void insert(long id, long shiftId, String workRole, int requiredCount, boolean isOptional) {
    execute(
        """
        INSERT INTO core.shift_role_requirement (id, shift_id, work_role, required_count, is_optional)
        VALUES (?, ?, ?::core.work_role_enum, ?, ?)
        """,
        id, shiftId, workRole, requiredCount, isOptional
    );
  }

  private RoleRequirementRecord mapRecord(ResultSet rs) {
    try {
      return new RoleRequirementRecord(
          rs.getLong("id"),
          rs.getLong("shift_id"),
          rs.getString("work_role"),
          rs.getInt("required_count"),
          rs.getBoolean("is_optional"),
          rs.getTimestamp("created_at").toInstant()
      );
    } catch (SQLException e) {
      throw new IllegalStateException("Unable to map shift_role_requirement row", e);
    }
  }
}
