#!/usr/bin/env bash
set -euo pipefail

# Reemplaza placeholders de stageVariables en el Swagger y genera un JSON listo para importar.
INPUT_FILE="${1:-docs/aws-apigateway-swagger-v1.json}"
OUTPUT_FILE="${2:-docs/aws-apigateway-swagger-v1.resolved.json}"

REGION="your-aws-region" # Reemplaza con tu región de AWS
LAMBDA_ARN="arn:aws:lambda:your-aws-region:your-account-id:function:your-lambda-function"

if [[ ! -f "$INPUT_FILE" ]]; then
	echo "ERROR: No existe el archivo de entrada: $INPUT_FILE"
	exit 1
fi

TMP_FILE="$(mktemp)"

sed \
	-e "s|\${stageVariables.awsRegion}|${REGION}|g" \
	-e "s|\${stageVariables.lambdaArn}|${LAMBDA_ARN}|g" \
	"$INPUT_FILE" > "$TMP_FILE"

if command -v jq >/dev/null 2>&1; then
	jq 'del(.security)' "$TMP_FILE" > "${TMP_FILE}.clean"
	mv "${TMP_FILE}.clean" "$TMP_FILE"
	jq empty "$TMP_FILE" >/dev/null
else
	# Compatibilidad API Gateway REST + OpenAPI 2: no soporta security top-level.
	sed -i '' '/^[[:space:]]*"security"[[:space:]]*:[[:space:]]*\[{[[:space:]]*"ApiKeyAuth"[[:space:]]*:[[:space:]]*\[\][[:space:]]*}\],[[:space:]]*$/d' "$TMP_FILE"
fi

mv "$TMP_FILE" "$OUTPUT_FILE"

echo "OK: JSON listo para importar"
echo "Entrada : $INPUT_FILE"
echo "Salida  : $OUTPUT_FILE"
echo "Region  : $REGION"
echo "Lambda  : $LAMBDA_ARN"