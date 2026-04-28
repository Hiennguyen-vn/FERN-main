path "kv/data/fern/shared" { capabilities = ["read"] }
path "kv/metadata/fern/shared" { capabilities = ["read"] }
path "kv/data/fern/services/payroll-service" { capabilities = ["read"] }
path "kv/data/fern/services/payroll-service/*" { capabilities = ["read"] }
path "database/creds/fern-payroll-service" { capabilities = ["read"] }
