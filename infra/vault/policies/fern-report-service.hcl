path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/report-service" { capabilities = ["read"] }
path "kv/data/fern/services/report-service/*" { capabilities = ["read"] }
path "database/creds/fern-report-service" { capabilities = ["read"] }
