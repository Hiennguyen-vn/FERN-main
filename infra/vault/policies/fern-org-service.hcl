path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/org-service" { capabilities = ["read"] }
path "kv/data/fern/services/org-service/*" { capabilities = ["read"] }
path "database/creds/fern-org-service" { capabilities = ["read"] }
