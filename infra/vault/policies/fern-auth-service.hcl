path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/auth-service" { capabilities = ["read"] }
path "kv/data/fern/services/auth-service/*" { capabilities = ["read"] }
path "database/creds/fern-auth-service" { capabilities = ["read"] }
