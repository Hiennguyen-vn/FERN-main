# Vault Secret Management Plan

> Migration from plaintext `.env` files to HashiCorp Vault KV v2.
> Foundation wired (dev container in compose). This doc is the runbook for full rollout.

## Current state

| Secret | Storage | Risk |
|--------|---------|------|
| `POSTGRES_PASSWORD`, `POSTGRES_APP_PASSWORD`, `POSTGRES_REPLICATION_PASSWORD` | `.env` | Committed `.env.example` has placeholders, prod `.env` is gitignored but copy-paste-able |
| `JWT_SECRET` | `.env` (`requireEnv("JWT_SECRET")`) | 64-byte random; rotation requires manual restart of all services |
| `INTERNAL_SERVICE_TOKEN` | `.env` | Shared across all services for inter-service auth |
| `AWS_SECRET_ACCESS_KEY` | `.env` | MinIO/S3 access |
| `VAULT_DEV_TOKEN` | `.env` | Bootstrap-only |

Read points (from grep audit):
- `JwtTokenService` ← `FernSharedConfiguration.requireEnv("JWT_SECRET")`
- `SpringInternalServiceAuth` ← `INTERNAL_SERVICE_TOKEN`
- `FernServiceProperties` ← Postgres credentials via `dependencies.postgres.*`
- AWS S3 client ← env vars

## Target state

```
vault://kv/fern/
├── shared/
│   ├── jwt        → { secret: "..." }
│   ├── internal   → { token: "..." }
│   └── kafka      → { sasl_password: "..." }
├── postgres/
│   ├── primary    → { user, password, replication_password }
│   └── app        → { user: "fern_app", password }
├── s3/
│   └── credentials → { access_key, secret_key }
└── services/
    ├── auth-service     → service-specific overrides
    ├── sales-service
    └── ...
```

ACL by service: each service has a Vault token with read access to `kv/fern/shared/*` + its own `services/<name>/` subtree.

## Phases

### Phase 1 — Local dev (Done)
- Vault container in `infra/docker-compose.yml` profile `secrets` (dev mode, no persistence, root token `fern-dev-root`).
- `.env.example` adds `VAULT_ADDR`, `VAULT_TOKEN`.
- Bring up: `docker compose --profile secrets up -d vault`.

### Phase 2 — Spring Cloud Vault wiring
1. Add `spring-cloud-starter-vault-config` to `service-common` (optional dep).
2. Each service `application.yml`:
   ```yaml
   spring:
     config:
       import: optional:vault://
     cloud:
       vault:
         uri: ${VAULT_ADDR:http://vault:8200}
         token: ${VAULT_TOKEN}
         kv:
           enabled: true
           backend: kv
           default-context: fern/shared
           application-name: fern/services/${spring.application.name}
   ```
3. Replace `requireEnv("JWT_SECRET")` with `@Value("${jwt.secret}")` reading from Vault context `fern/shared/jwt#secret`.
4. Replace `dependencies.postgres.password` plumbing — bind via Vault `fern/postgres/app#password`.

### Phase 3 — Secret seeding
Bootstrap script `infra/scripts/vault-seed-dev.sh`:
```bash
vault kv put kv/fern/shared/jwt secret="$(openssl rand -hex 64)"
vault kv put kv/fern/shared/internal token="$(openssl rand -hex 32)"
vault kv put kv/fern/postgres/app user=fern_app password=fern_app
vault kv put kv/fern/s3/credentials access_key=minioadmin secret_key=minioadmin
```

Run once after bringing up dev Vault.

### Phase 4 — Per-service ACL
1. Create policy file per service:
   ```hcl
   path "kv/data/fern/shared/*" { capabilities = ["read"] }
   path "kv/data/fern/services/sales-service/*" { capabilities = ["read"] }
   ```
2. AppRole auth: each service gets RoleID + SecretID, mounted as `VAULT_ROLE_ID` / `VAULT_SECRET_ID` env at deploy.
3. Replace root token with AppRole login in production yaml.

### Phase 5 — Production deploy
- Vault HA cluster (3 nodes, Raft storage) — separate from app cluster.
- Auto-unseal via cloud KMS (AWS KMS / GCP KMS).
- Audit log to S3.
- Backup: snapshot every 6h via `vault operator raft snapshot`.
- Secret rotation cadence:
  - JWT secret: 90 days (with grace window: dual-secret support during rotation)
  - DB passwords: 30 days (using Vault dynamic credentials for Postgres)
  - Internal service token: 90 days

### Phase 6 — Dynamic DB credentials (advanced)
Replace static `POSTGRES_APP_PASSWORD` with Vault Postgres database engine:
- Vault generates short-lived (1h TTL) Postgres roles per service request.
- Spring Cloud Vault auto-renews lease.
- Compromised credential auto-expires within 1h.

## Verification

```bash
# Phase 1 verify
docker compose --profile secrets up -d vault
docker compose exec vault vault status     # Initialized: true, Sealed: false

# Phase 2 verify (after wiring)
curl -s localhost:8081/actuator/health | jq '.components.vault.status'  # UP

# Phase 4 verify
vault token lookup -accessor <accessor>    # confirm policy attached
```

## Rollback

Each phase is opt-in:
- Phase 1–2: Vault container off → services fall back to env vars (Spring Cloud Vault `optional:vault://` import)
- Phase 5: feature flag per service `spring.cloud.vault.enabled=false` → revert to env

## Risks

| Risk | Mitigation |
|------|-----------|
| Vault outage → services can't start | Token lease cache (Spring Cloud Vault) + fallback env vars |
| Token leak via logs | `spring.cloud.vault.config.lifecycle.enabled=false` for stateless tokens; mask secret values in actuator |
| Bootstrap chicken-and-egg | Use AppRole + sidecar init container in K8s |
| Dev token in CI | CI uses ephemeral Vault per pipeline run, never shares prod tokens |

## Definition of done

- [ ] Phase 1 (local dev container) — DONE
- [ ] Phase 2 (Spring Cloud Vault) — JWT + Postgres pwd via Vault
- [ ] Phase 3 (seed script) — committed at `infra/scripts/vault-seed-dev.sh`
- [ ] Phase 4 (per-service ACL) — policy files + AppRole IDs
- [ ] Phase 5 (prod cluster) — HA + KMS unseal + backup
- [ ] Phase 6 (dynamic DB creds) — short-lived Postgres roles
- [ ] All `requireEnv` calls replaced with Vault-backed values
- [ ] `.env` files contain only non-secret config (ports, hosts)
