path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/audit-service" { capabilities = ["read"] }
path "kv/data/fern/services/audit-service/*" { capabilities = ["read"] }
path "database/creds/fern-audit-service" { capabilities = ["read"] }
