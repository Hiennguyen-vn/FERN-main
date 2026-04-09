package com.dorabets.common.repository;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertTrue;

class SchemaInitRegressionTest {

    @Test
    void rootContainsExpectedBackendEntryPoints() throws IOException {
        assertTrue(Files.exists(readRepoPath("pom.xml")));
        assertTrue(Files.exists(readRepoPath(".mvn/maven.config")));
        assertTrue(Files.exists(readRepoPath("infra/docker-compose.yml")));
        assertTrue(Files.exists(readRepoPath("README.md")));

        String mavenConfig = Files.readString(readRepoPath(".mvn/maven.config"));
        assertTrue(mavenConfig.contains("-T 1C"));
    }

    @Test
    void commonParentRegistersImportedSharedModules() throws IOException {
        String commonPom = Files.readString(readRepoPath("common/pom.xml"));

        assertTrue(commonPom.contains("<module>common-model</module>"));
        assertTrue(commonPom.contains("<module>common-utils</module>"));
        assertTrue(commonPom.contains("<module>idempotency-core</module>"));
        assertTrue(commonPom.contains("<module>service-common</module>"));
    }

    @Test
    void importedCommonSourcesExistInExpectedModules() throws IOException {
        assertTrue(Files.exists(readRepoPath(
                "common/common-model/src/main/java/com/natsu/common/model/cache/Cache.java")));
        assertTrue(Files.exists(readRepoPath(
                "common/common-utils/src/main/java/com/natsu/common/utils/config/Configuration.java")));
        assertTrue(Files.exists(readRepoPath(
                "common/idempotency-core/src/main/java/com/dorabets/idempotency/IdempotencyGuard.java")));
        assertTrue(Files.exists(readRepoPath(
                "common/service-common/src/main/java/com/dorabets/common/server/ServiceApp.java")));
    }

    @Test
    void rootInfrastructureMatchesBackendStarterExpectations() throws IOException {
        String infraCompose = Files.readString(readRepoPath("infra/docker-compose.yml"));
        String dbReadme = Files.readString(readRepoPath("db/README.md"));
        String rootReadme = Files.readString(readRepoPath("README.md"));

        assertTrue(infraCompose.contains("postgres"));
        assertTrue(infraCompose.contains("redis"));
        assertTrue(dbReadme.contains("migrations"));
        assertTrue(rootReadme.contains("frontend-startup.md"));
    }

    private static Path readRepoPath(String relativePath) {
        return findRepoRoot().resolve(relativePath);
    }

    private static Path findRepoRoot() {
        Path current = Path.of("").toAbsolutePath();
        while (current != null) {
            if (Files.exists(current.resolve("pom.xml"))
                    && Files.exists(current.resolve("common/pom.xml"))
                    && Files.exists(current.resolve("services/pom.xml"))) {
                return current;
            }
            current = current.getParent();
        }
        throw new IllegalStateException("Could not locate repository root");
    }
}
