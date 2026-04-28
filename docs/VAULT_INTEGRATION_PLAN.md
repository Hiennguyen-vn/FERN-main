# Vault Secret Management Runbook

FERN services support three Vault modes:

| Mode | Runtime flags | Purpose |
|------|---------------|---------|
| Disabled env fallback | `VAULT_ENABLED=false` | CI/local runs without Vault. Required secrets still come from explicit env vars. |
| Local dev token | `VAULT_ENABLED=true`, `VAULT_AUTHENTICATION=TOKEN`, `VAULT_TOKEN=fern-dev-root` | Local compose Vault profile. Dev only. |
| AppRole | `VAULT_ENABLED=true`, `VAULT_AUTHENTICATION=APPROLE`, `VAULT_ROLE_ID`, `VAULT_SECRET_ID` | Staging/prod service authentication. |

No production deployment should rely on a committed `.env` secret. Deployment owners provide
RoleID/SecretID, database admin bootstrap credentials, KMS values, and TLS material through the
target platform.

## Spring Binding

All Spring services and gateway import `optional:vault://`. Vault-backed values are mapped to the
same application properties the code already consumes:

| Vault / lease output | Spring property |
|----------------------|-----------------|
| `kv/fern/shared` key `jwt.secret` | `jwt.secret` |
| `kv/fern/shared` key `internal.service.token` | `internal.service.token` |
| `kv/fern/shared` key `internal.service.allowlist` | `internal.service.allowlist` |
| Vault database backend `username` | `dependencies.postgres.username` |
| Vault database backend `password` | `dependencies.postgres.password` |

Fallback remains explicit:

```bash
VAULT_ENABLED=false
JWT_SECRET=...
INTERNAL_SERVICE_TOKEN=...
POSTGRES_APP_USER=...
POSTGRES_APP_PASSWORD=...
```

## Local Dev

Start Vault and seed KV/AppRole:

```bash
docker compose -f infra/docker-compose.yml --profile secrets up -d vault
./infra/scripts/vault-seed-dev.sh
```

Use token mode for the fastest local check:

```bash
export VAULT_ENABLED=true
export VAULT_AUTHENTICATION=TOKEN
export VAULT_TOKEN=fern-dev-root
```

Use AppRole mode by taking the printed values from the seed script:

```bash
export VAULT_ENABLED=true
export VAULT_AUTHENTICATION=APPROLE
export VAULT_ROLE_ID=<printed role_id>
export VAULT_SECRET_ID=<printed secret_id>
```

Verify:

```bash
vault kv get kv/fern/shared
vault read auth/approle/role/fern-sales-service/role-id
curl -s localhost:8087/actuator/health | jq '.components.vault.status'
```

## Dynamic Postgres Credentials

The database secrets engine is intentionally separate from the dev seed because it needs a
Postgres admin credential that must not be committed.

```bash
export VAULT_POSTGRES_ADMIN_USERNAME=<admin role>
export VAULT_POSTGRES_ADMIN_PASSWORD=<admin password>
export VAULT_POSTGRES_HOST=<postgres host>
export VAULT_POSTGRES_DB=fern
./infra/scripts/vault-enable-postgres-dynamic-creds.sh
```

Service runtime:

```bash
export VAULT_DATABASE_ENABLED=true
export VAULT_DATABASE_BACKEND=database
export VAULT_DATABASE_ROLE=fern-sales-service
```

Manual verification:

```bash
vault read database/creds/fern-sales-service
```

The issued lease should expose `username` and `password`; Spring Cloud Vault writes them into
`dependencies.postgres.username` and `dependencies.postgres.password`, and the shared Hikari
configuration consumes those values.

## Policies And AppRole

Policy files live in `infra/vault/policies/fern-<service>.hcl`. Each service can read:

- `kv/data/fern/shared`
- `kv/data/fern/services/<service>`
- `database/creds/fern-<service>`

Create/update policies and AppRole roles:

```bash
./infra/scripts/vault-seed-dev.sh
```

Production should set `CREATE_SECRET_IDS=false` during policy sync and issue SecretIDs through the
deployment platform or secret broker.

## Production HA

Template manifest: `infra/vault/prod/vault-ha-raft.yaml`.

Before applying it, deployment owners must supply:

- TLS secret `vault-tls`.
- Cloud KMS auto-unseal values, replacing `REPLACE_AWS_REGION` and `REPLACE_KMS_KEY_ID`.
- Persistent volume class and size.
- Network policy permitting only app namespaces and operator access.
- IAM permissions for KMS decrypt/encrypt/describe-key.

Initialize only once:

```bash
kubectl -n fern-secrets exec vault-0 -- vault operator init -format=json > vault-init.json
kubectl -n fern-secrets exec vault-0 -- vault operator raft list-peers
```

Unseal should be automatic through KMS. If manual unseal is required in a break-glass event:

```bash
kubectl -n fern-secrets exec vault-0 -- vault operator unseal <key-share>
kubectl -n fern-secrets exec vault-1 -- vault operator unseal <key-share>
kubectl -n fern-secrets exec vault-2 -- vault operator unseal <key-share>
```

## Audit And Backup

Enable audit logging to a platform-owned sink:

```bash
vault audit enable file file_path=/vault/audit/vault-audit.log
```

Schedule Raft snapshots at least every 6 hours:

```bash
vault operator raft snapshot save /backup/vault-$(date +%Y%m%d%H%M%S).snap
```

Restore drill:

```bash
vault operator raft snapshot restore -force /backup/<snapshot>.snap
vault operator raft list-peers
vault status
```

## Rotation

| Secret | Target cadence | Notes |
|--------|----------------|-------|
| AppRole SecretID | 30 days | Issue new SecretID, roll service, revoke old accessor. |
| Dynamic Postgres lease | 1 hour default, 4 hour max | Auto-renewed by Spring Cloud Vault while service is healthy. |
| `internal.service.token` | 90 days | Requires rolling restart until dual-token support is added. |
| `jwt.secret` | 90 days | Requires planned grace-period work before zero-downtime rotation. |

## Rollback

Set `VAULT_ENABLED=false` and provide explicit env secrets. Do not leave `VAULT_TOKEN` or
`VAULT_SECRET_ID` in committed files.
