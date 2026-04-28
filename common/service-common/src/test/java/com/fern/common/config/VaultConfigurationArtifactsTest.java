package com.fern.common.config;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

class VaultConfigurationArtifactsTest {

  private static final List<String> SERVICES = List.of(
      "gateway",
      "auth-service",
      "master-node",
      "org-service",
      "hr-service",
      "product-service",
      "procurement-service",
      "sales-service",
      "inventory-service",
      "payroll-service",
      "finance-service",
      "audit-service",
      "report-service");

  @Test
  void perServicePoliciesExistForAllRuntimeServices() throws Exception {
    Path root = repoRoot();

    for (String service : SERVICES) {
      Path policy = root.resolve("infra/vault/policies/fern-" + service + ".hcl");
      assertTrue(Files.isRegularFile(policy), "missing policy " + policy);
      String text = Files.readString(policy);
      assertTrue(text.contains("kv/data/fern/shared"), "missing shared KV policy for " + service);
      assertTrue(text.contains("kv/data/fern/services/" + service), "missing service KV policy for " + service);
      assertTrue(text.contains("database/creds/fern-" + service), "missing database creds policy for " + service);
    }
  }

  @Test
  void vaultScriptsUseStrictModeAndParseAsBash() throws Exception {
    Path root = repoRoot();
    for (String script : List.of(
        "infra/scripts/vault-seed-dev.sh",
        "infra/scripts/vault-enable-postgres-dynamic-creds.sh")) {
      Path path = root.resolve(script);
      String text = Files.readString(path);
      assertTrue(text.contains("set -euo pipefail"), "script must use strict mode: " + script);

      Process process = new ProcessBuilder("bash", "-n", path.toString())
          .directory(root.toFile())
          .start();
      assertEquals(0, process.waitFor(), "bash -n failed for " + script);
    }
  }

  @Test
  void applicationYamlBindsAppRoleAndDynamicPostgresCreds() throws Exception {
    Path root = repoRoot();
    for (String service : SERVICES) {
      Path yaml = applicationYaml(root, service);
      String text = Files.readString(yaml);
      assertTrue(text.contains("authentication: ${VAULT_AUTHENTICATION:TOKEN}"), service);
      assertTrue(text.contains("role-id: ${VAULT_ROLE_ID:}"), service);
      assertTrue(text.contains("secret-id: ${VAULT_SECRET_ID:}"), service);
      assertTrue(text.contains("username-property: dependencies.postgres.username"), service);
      assertTrue(text.contains("password-property: dependencies.postgres.password"), service);
    }
  }

  private static Path applicationYaml(Path root, String service) {
    if ("gateway".equals(service)) {
      return root.resolve("gateway/src/main/resources/application.yml");
    }
    if ("auth-service".equals(service)) {
      return root.resolve("services/auth-service/spring/src/main/resources/application.yml");
    }
    return root.resolve("services/" + service + "/src/main/resources/application.yml");
  }

  private static Path repoRoot() {
    Path current = Path.of("").toAbsolutePath();
    while (current != null) {
      if (Files.isDirectory(current.resolve("infra/vault/policies"))) {
        return current;
      }
      current = current.getParent();
    }
    throw new IllegalStateException("Could not locate repo root");
  }
}
