package com.fern.services.product.infrastructure;

import com.fern.common.repository.BaseRepository;
import com.fern.services.product.api.AllergenDtos;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.sql.DataSource;
import org.springframework.stereotype.Repository;

@Repository
public class AllergenRepository extends BaseRepository {

  public AllergenRepository(DataSource dataSource) {
    super(dataSource);
  }

  public List<AllergenDtos.AllergenView> listAll() {
    return executeInTransaction(conn -> {
      List<AllergenDtos.AllergenView> out = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT code, label, label_en, icon, sort_order
          FROM core.allergen
          WHERE active = true
          ORDER BY sort_order, code
          """
      )) {
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            out.add(new AllergenDtos.AllergenView(
                rs.getString("code"),
                rs.getString("label"),
                rs.getString("label_en"),
                rs.getString("icon"),
                rs.getInt("sort_order")
            ));
          }
        }
      }
      return out;
    });
  }

  public List<AllergenDtos.ProductAllergenView> listForProduct(long productId) {
    return executeInTransaction(conn -> {
      List<AllergenDtos.ProductAllergenView> out = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT a.code, a.label, a.label_en, a.icon, pa.is_traces
          FROM core.product_allergen pa
          JOIN core.allergen a ON a.code = pa.allergen_code
          WHERE pa.product_id = ?
          ORDER BY a.sort_order, a.code
          """
      )) {
        ps.setLong(1, productId);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            out.add(new AllergenDtos.ProductAllergenView(
                rs.getString("code"),
                rs.getString("label"),
                rs.getString("label_en"),
                rs.getString("icon"),
                rs.getBoolean("is_traces")
            ));
          }
        }
      }
      return out;
    });
  }

  public List<AllergenDtos.ProductAllergenView> setForProduct(
      long productId,
      List<AllergenDtos.ProductAllergenInput> inputs
  ) {
    executeInTransaction(conn -> {
      try (PreparedStatement del = conn.prepareStatement(
          "DELETE FROM core.product_allergen WHERE product_id = ?"
      )) {
        del.setLong(1, productId);
        del.executeUpdate();
      }
      if (inputs != null && !inputs.isEmpty()) {
        try (PreparedStatement ins = conn.prepareStatement(
            "INSERT INTO core.product_allergen (product_id, allergen_code, is_traces) VALUES (?, ?, ?) "
            + "ON CONFLICT (product_id, allergen_code) DO UPDATE SET is_traces = EXCLUDED.is_traces"
        )) {
          Set<String> seen = new HashSet<>();
          for (AllergenDtos.ProductAllergenInput in : inputs) {
            if (in.code() == null || in.code().isBlank()) continue;
            if (!seen.add(in.code())) continue;
            ins.setLong(1, productId);
            ins.setString(2, in.code());
            ins.setBoolean(3, in.isTraces());
            ins.addBatch();
          }
          ins.executeBatch();
        }
      }
      return null;
    });
    return listForProduct(productId);
  }

  public List<AllergenDtos.CustomerAllergyView> listForCustomer(long customerId) {
    return executeInTransaction(conn -> {
      List<AllergenDtos.CustomerAllergyView> out = new ArrayList<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT ca.allergen_code, a.label, a.label_en, a.icon, ca.severity, ca.note
          FROM core.customer_allergy ca
          JOIN core.allergen a ON a.code = ca.allergen_code
          WHERE ca.customer_id = ?
          ORDER BY ca.severity DESC, a.sort_order
          """
      )) {
        ps.setLong(1, customerId);
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            out.add(new AllergenDtos.CustomerAllergyView(
                rs.getString("allergen_code"),
                rs.getString("label"),
                rs.getString("label_en"),
                rs.getString("icon"),
                rs.getString("severity"),
                rs.getString("note")
            ));
          }
        }
      }
      return out;
    });
  }

  public List<AllergenDtos.CustomerAllergyView> setForCustomer(
      long customerId,
      List<AllergenDtos.CustomerAllergyInput> inputs
  ) {
    executeInTransaction(conn -> {
      try (PreparedStatement del = conn.prepareStatement(
          "DELETE FROM core.customer_allergy WHERE customer_id = ?"
      )) {
        del.setLong(1, customerId);
        del.executeUpdate();
      }
      if (inputs != null && !inputs.isEmpty()) {
        try (PreparedStatement ins = conn.prepareStatement(
            "INSERT INTO core.customer_allergy (customer_id, allergen_code, severity, note) "
            + "VALUES (?, ?, ?, ?) ON CONFLICT (customer_id, allergen_code) DO UPDATE "
            + "SET severity = EXCLUDED.severity, note = EXCLUDED.note, updated_at = NOW()"
        )) {
          Set<String> seen = new HashSet<>();
          for (AllergenDtos.CustomerAllergyInput in : inputs) {
            if (in.code() == null || in.code().isBlank()) continue;
            if (!seen.add(in.code())) continue;
            ins.setLong(1, customerId);
            ins.setString(2, in.code());
            ins.setString(3, in.severity() == null ? "AVOID" : in.severity());
            ins.setString(4, in.note());
            ins.addBatch();
          }
          ins.executeBatch();
        }
      }
      return null;
    });
    return listForCustomer(customerId);
  }

  public List<AllergenDtos.ProductAllergenMapEntry> listForAllProducts() {
    return executeInTransaction(conn -> {
      java.util.Map<Long, List<AllergenDtos.ProductAllergenView>> grouped = new java.util.LinkedHashMap<>();
      try (PreparedStatement ps = conn.prepareStatement(
          """
          SELECT pa.product_id, a.code, a.label, a.label_en, a.icon, pa.is_traces
          FROM core.product_allergen pa
          JOIN core.allergen a ON a.code = pa.allergen_code
          ORDER BY pa.product_id, a.sort_order, a.code
          """
      )) {
        try (ResultSet rs = ps.executeQuery()) {
          while (rs.next()) {
            long pid = rs.getLong("product_id");
            grouped.computeIfAbsent(pid, k -> new ArrayList<>()).add(
                new AllergenDtos.ProductAllergenView(
                    rs.getString("code"),
                    rs.getString("label"),
                    rs.getString("label_en"),
                    rs.getString("icon"),
                    rs.getBoolean("is_traces")
                ));
          }
        }
      }
      List<AllergenDtos.ProductAllergenMapEntry> out = new ArrayList<>();
      grouped.forEach((pid, list) -> out.add(new AllergenDtos.ProductAllergenMapEntry(pid, list)));
      return out;
    });
  }
}
