#!/bin/bash
# webhook-test.sh - Script to test webhook HMAC validation

echo "🧪 Testing Webhook HMAC Validation"
echo "==================================="

BASE_URL="https://pricebooster-app-hkfq8.ondigitalocean.app"

# Test 1: Invalid HMAC (should return 401)
echo "Test 1: Invalid HMAC signature"
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: invalid_signature" \
  -H "X-Shopify-Topic: customers/data_request" \
  -H "X-Shopify-Shop-Domain: test-shop.myshopify.com" \
  -d '{"test": "data"}' \
  "$BASE_URL/webhooks/gdpr")

if [ "$response" = "401" ]; then
  echo "✅ PASS: Invalid HMAC returned 401"
else
  echo "❌ FAIL: Invalid HMAC returned $response (expected 401)"
fi

# Test 2: Missing HMAC (should return 401)
echo ""
echo "Test 2: Missing HMAC signature"
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Topic: customers/data_request" \
  -H "X-Shopify-Shop-Domain: test-shop.myshopify.com" \
  -d '{"test": "data"}' \
  "$BASE_URL/webhooks/gdpr")

if [ "$response" = "401" ]; then
  echo "✅ PASS: Missing HMAC returned 401"
else
  echo "❌ FAIL: Missing HMAC returned $response (expected 401)"
fi

# Test 3: Test app uninstalled webhook
echo ""
echo "Test 3: App uninstalled webhook"
response=$(curl -s -w "%{http_code}" -o /dev/null \
  -X POST \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: invalid_signature" \
  -H "X-Shopify-Topic: app/uninstalled" \
  -H "X-Shopify-Shop-Domain: test-shop.myshopify.com" \
  -d '{"test": "data"}' \
  "$BASE_URL/webhooks/app/uninstalled")

if [ "$response" = "401" ]; then
  echo "✅ PASS: App uninstalled invalid HMAC returned 401"
else
  echo "❌ FAIL: App uninstalled invalid HMAC returned $response (expected 401)"
fi

echo ""
echo "🏁 Testing completed!"
echo "If all tests show ✅ PASS, your webhooks are properly configured for Shopify App Store approval."