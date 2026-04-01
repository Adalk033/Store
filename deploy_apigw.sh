#!/usr/bin/env bash
set -euo pipefail

# Deploy API Gateway REST API from OpenAPI swagger and always enforce method security.
#
# Required env vars:
#   AWS_REGION   (example: mx-central-1)
#   LAMBDA_ARN   (example: arn:aws:lambda:mx-central-1:xxxxx:function:dsdss-api-v1)
#
# Optional env vars:
#   REST_API_ID        (existing API id; if missing, script creates one)
#   STAGE_NAME         (default: prod)
#   SWAGGER_FILE       (default: docs/aws-apigateway-swagger-v1.json)
#   RESOLVED_SWAGGER   (default: docs/aws-apigateway-swagger-v1.resolved.json)

AWS_REGION="${AWS_REGION:-}"
LAMBDA_ARN="${LAMBDA_ARN:-}"
REST_API_ID="${REST_API_ID:-}"
STAGE_NAME="${STAGE_NAME:-prod}"
SWAGGER_FILE="${SWAGGER_FILE:-docs/aws-apigateway-swagger-v1.json}"
RESOLVED_SWAGGER="${RESOLVED_SWAGGER:-docs/aws-apigateway-swagger-v1.resolved.json}"

if [[ -z "$AWS_REGION" ]]; then
	echo "ERROR: AWS_REGION is required"
	exit 1
fi

if [[ -z "$LAMBDA_ARN" ]]; then
	echo "ERROR: LAMBDA_ARN is required"
	exit 1
fi

if [[ ! -f "$SWAGGER_FILE" ]]; then
	echo "ERROR: Swagger file not found: $SWAGGER_FILE"
	exit 1
fi

command -v aws >/dev/null 2>&1 || {
	echo "ERROR: aws CLI is not installed"
	exit 1
}

command -v jq >/dev/null 2>&1 || {
	echo "ERROR: jq is required"
	exit 1
}

tmp_file="$(mktemp)"

sed \
	-e "s|\${stageVariables.awsRegion}|${AWS_REGION}|g" \
	-e "s|\${stageVariables.lambdaArn}|${LAMBDA_ARN}|g" \
	"$SWAGGER_FILE" > "$tmp_file"

jq 'del(.security)' "$tmp_file" > "${tmp_file}.clean"
mv "${tmp_file}.clean" "$tmp_file"
jq empty "$tmp_file" >/dev/null

mv "$tmp_file" "$RESOLVED_SWAGGER"

if [[ -z "$REST_API_ID" ]]; then
	echo "Creating REST API from swagger..."
	REST_API_ID="$(aws apigateway import-rest-api \
		--region "$AWS_REGION" \
		--fail-on-warnings \
		--body "fileb://${RESOLVED_SWAGGER}" \
		--query id \
		--output text)"
	echo "Created REST API ID: $REST_API_ID"
else
	echo "Updating existing REST API: $REST_API_ID"
	aws apigateway put-rest-api \
		--region "$AWS_REGION" \
		--rest-api-id "$REST_API_ID" \
		--mode overwrite \
		--fail-on-warnings \
		--body "fileb://${RESOLVED_SWAGGER}" \
		>/dev/null
fi

echo "Enforcing method security (apiKeyRequired + validator) for every method..."
./cloud/apigw-enforce-method-security.sh "$REST_API_ID" "$STAGE_NAME" "$AWS_REGION"

echo "Deployment completed"
echo "REST_API_ID=$REST_API_ID"
echo "STAGE_NAME=$STAGE_NAME"