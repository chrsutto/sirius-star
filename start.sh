#!/bin/bash

echo "🚀 Starting Stablecoin Yield Dashboard..."
echo ""
echo "This will start the backend server which provides 150+ yield opportunities"
echo "from Morpho, Euler, and other DeFi protocols."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo ""
fi

echo "✅ Starting server..."
echo ""
echo "Once started, open your browser to:"
echo "👉 http://localhost:3000"
echo ""
echo "You should see 150-200 yield opportunities!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

node server.js
