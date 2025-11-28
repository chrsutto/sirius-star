#!/bin/bash

echo "🔍 Diagnosing Yield Aggregator Issues"
echo "======================================"
echo ""

echo "📊 Checking current yield counts..."
curl -s http://localhost:3000/api/debug | jq '{
  total: .summary.totalYields,
  sources: (.sources | to_entries | map({name: .key, count: .value.count}))
}'

echo ""
echo "🔍 Detailed breakdown:"
curl -s http://localhost:3000/api/debug | jq '.sources | to_entries[] | "\(.key): \(.value.count) yields"' -r

echo ""
echo "❌ Failed sources (if any):"
curl -s http://localhost:3000/api/debug | jq '.sources | to_entries[] | select(.value.status == "error") | "\(.key): \(.value.error)"' -r

echo ""
echo "📋 Expected vs Actual:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

DEFI=$(curl -s http://localhost:3000/api/debug | jq '.sources.defiLlama.count')
PENDLE=$(curl -s http://localhost:3000/api/debug | jq '.sources.pendle.count')
MERKL=$(curl -s http://localhost:3000/api/debug | jq '.sources.merkl.count')
MORPHO=$(curl -s http://localhost:3000/api/debug | jq '.sources.morpho.count')
EULER=$(curl -s http://localhost:3000/api/debug | jq '.sources.euler.count')
MANUAL=$(curl -s http://localhost:3000/api/debug | jq '.sources.manual.count')

echo "DeFi Llama: $DEFI (expected: 50)"
echo "Pendle:     $PENDLE (expected: 20)"
echo "Merkl:      $MERKL (expected: 15)"
echo "Morpho:     $MORPHO (expected: 40-80)"
echo "Euler:      $EULER (expected: 30-50)"
echo "Manual:     $MANUAL (expected: 14)"

echo ""
echo "🔧 Diagnosis:"

if [ "$MORPHO" -lt 20 ]; then
    echo "⚠️  MORPHO TOO LOW ($MORPHO vaults)"
    echo "    → Likely still using old filters or old files"
fi

if [ "$EULER" -lt 20 ]; then
    echo "⚠️  EULER TOO LOW ($EULER vaults)"
    echo "    → Likely still using old filters or old files"
fi

if [ "$PENDLE" -lt 5 ]; then
    echo "⚠️  PENDLE TOO LOW ($PENDLE vaults)"
    echo "    → Pendle API might be down or filters too strict"
fi

if [ "$DEFI" -lt 40 ]; then
    echo "⚠️  DEFILLAMA TOO LOW ($DEFI vaults)"
    echo "    → Should be showing 50 results"
fi

echo ""
echo "💡 Recommended actions:"

TOTAL=$(curl -s http://localhost:3000/api/debug | jq '.summary.totalYields')
if [ "$TOTAL" -lt 150 ]; then
    echo "1. Make sure you're using the LATEST package files"
    echo "2. Verify server.js has 'totalAssetsUsd > 100000' (not 1000000)"
    echo "3. Check server logs for any errors"
    echo "4. Try clearing cache again: curl http://localhost:3000/api/clear-cache"
fi

echo ""
echo "✅ To fix, try this:"
echo "   1. Stop server (Ctrl+C)"
echo "   2. Replace server.js with the latest version from the package"
echo "   3. Restart: node server.js"
echo "   4. Clear cache: curl http://localhost:3000/api/clear-cache"
echo "   5. Run this script again"
