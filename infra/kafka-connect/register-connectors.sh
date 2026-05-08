#!/bin/sh
# Register Kafka Connect connectors via the REST API
set -e

CONNECT_URL="${KAFKA_CONNECT_URL:-http://kafka-connect:8083}"
CONNECTORS_DIR="/connectors"

echo "Waiting for Kafka Connect at ${CONNECT_URL}..."
until curl -sf "${CONNECT_URL}/connectors" >/dev/null 2>&1; do
  sleep 3
done

echo "Kafka Connect ready. Registering connectors..."

available_plugins="$(curl -sf "${CONNECT_URL}/connector-plugins" || echo "[]")"

for connector_file in "${CONNECTORS_DIR}"/*.json; do
  connector_name=$(python3 -c "import json,sys; print(json.load(open('${connector_file}'))['name'])" 2>/dev/null \
    || grep -o '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "${connector_file}" | head -1 | sed 's/.*: *"\(.*\)"/\1/')
  connector_class=$(python3 -c "import json,sys; print(json.load(open('${connector_file}'))['config']['connector.class'])" 2>/dev/null \
    || grep -o '"connector.class"[[:space:]]*:[[:space:]]*"[^"]*"' "${connector_file}" | head -1 | sed 's/.*: *"\(.*\)"/\1/')

  echo "Checking connector: ${connector_name}"
  if ! echo "${available_plugins}" | grep -q "\"class\"[[:space:]]*:[[:space:]]*\"${connector_class}\""; then
    echo "Skipping ${connector_name}: plugin class ${connector_class} is not installed."
    echo ""
    continue
  fi

  status=$(curl -s -o /dev/null -w "%{http_code}" "${CONNECT_URL}/connectors/${connector_name}")

  if [ "${status}" = "200" ]; then
    echo "Connector ${connector_name} already exists, updating..."
    curl -sf -X PUT "${CONNECT_URL}/connectors/${connector_name}/config" \
      -H "Content-Type: application/json" \
      -d "$(python3 -c "import json,sys; d=json.load(open('${connector_file}')); print(json.dumps(d['config']))" 2>/dev/null \
            || cat "${connector_file}" | sed 's/^{//' | sed 's/}$//' | sed 's/"name"[^,]*,//')"
  else
    echo "Registering connector: ${connector_name}"
    curl -sf -X POST "${CONNECT_URL}/connectors" \
      -H "Content-Type: application/json" \
      -d @"${connector_file}"
  fi
  echo ""
done

echo "All connectors registered."
