path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/hr-service" { capabilities = ["read"] }
path "kv/data/fern/services/hr-service/*" { capabilities = ["read"] }
path "database/creds/fern-hr-service" { capabilities = ["read"] }
