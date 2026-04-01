#!/usr/bin/env bash
set -euo pipefail

# Applies PostgreSQL schema to AWS RDS using psql.
# Usage:
#   export PGHOST="your-rds-endpoint"
#   export PGPORT="5432"
#   export PGDATABASE="your-database-name"
#   export PGUSER="postgres"
#   export PGPASSWORD="your_password"
#   ./cloud/apply-schema-rds.sh
#
# Optional:
#   SCHEMA_FILE="cloud/postgres_schema.sql" ./cloud/apply-schema-rds.sh
#   SSLMODE="require" ./cloud/apply-schema-rds.sh

SCHEMA_FILE="${SCHEMA_FILE:-postgres_schema.sql}"
SSLMODE="${SSLMODE:-require}"

command -v psql >/dev/null 2>&1 || {
  echo "ERROR: psql is not installed."
  echo "Install on macOS: brew install libpq && export PATH=\"/opt/homebrew/opt/libpq/bin:\$PATH\""
  exit 1
}

: "${PGHOST:?ERROR: missing PGHOST}"
: "${PGPORT:=5432}"
: "${PGDATABASE:?ERROR: missing PGDATABASE}"
: "${PGUSER:?ERROR: missing PGUSER}"
: "${PGPASSWORD:?ERROR: missing PGPASSWORD}"

if [[ ! -f "$SCHEMA_FILE" ]]; then
  echo "ERROR: schema file not found: $SCHEMA_FILE"
  exit 1
fi

CONN="host=${PGHOST} port=${PGPORT} dbname=${PGDATABASE} user=${PGUSER} password=${PGPASSWORD} sslmode=${SSLMODE}"

echo "Testing connection to ${PGHOST}:${PGPORT}/${PGDATABASE} ..."
psql "$CONN" -v ON_ERROR_STOP=1 -c "SELECT NOW() AS connected_at;"

echo "Applying schema file: $SCHEMA_FILE"
psql "$CONN" -v ON_ERROR_STOP=1 -f "$SCHEMA_FILE"

echo "Schema applied successfully."

echo "Quick validation:"
psql "$CONN" -v ON_ERROR_STOP=1 -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
