// Debug endpoint for Vercel
// Shows which API sources are working/failing

// Helper function to fetch with retry
async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}

// Test each API source
async function testAPIs() {
  const results = {};

  // Test DeFi Llama
  try {
    const data = await fetchWithRetry('https://yields.llama.fi/pools');
    const count = data.data.filter(p => p.stablecoin === true && p.tvlUsd > 100000 && p.apy < 200).slice(0, 50).length;
    results.defiLlama = { status: 'success', count, sample: data.data[0]?.project };
  } catch (err) {
    results.defiLlama = { status: 'error', error: err.message };
  }

  // Test Morpho
  try {
    const query = `{
      vaultV2s(first: 100, where: { chainId_in: [1, 8453], whitelisted: true }) {
        items {
          address
          name
          symbol
          totalAssetsUsd
          avgNetApy
          asset { symbol }
          chain { network }
        }
      }
    }`;

    const response = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    // All Morpho vaults are curated, so include all with TVL > $100K
    const count = data.data?.vaultV2s?.items?.filter(v => v.totalAssetsUsd > 100000).length || 0;
    
    results.morpho = { 
      status: 'success', 
      count,
      total: data.data?.vaultV2s?.items?.length || 0,
      sample: data.data?.vaultV2s?.items?.[0]?.name
    };
  } catch (err) {
    results.morpho = { status: 'error', error: err.message };
  }

  // Test Euler (via DeFi Llama)
  try {
    const data = await fetchWithRetry('https://yields.llama.fi/pools');
    const eulerPools = data.data.filter(pool => 
      (pool.project === 'euler-v2' || pool.project === 'euler') &&
      pool.tvlUsd > 100000 &&
      pool.apy < 200
    );
    const count = eulerPools.filter(p => {
      const s = p.symbol.toUpperCase();
      return s.includes('USDC') || s.includes('USDT') || s.includes('DAI') || s.includes('USDS') || s.includes('PYUSD') || s.includes('FRAX') || s.includes('LUSD');
    }).length;
    
    results.euler = { status: 'success', count, totalPools: eulerPools.length };
  } catch (err) {
    results.euler = { status: 'error', error: err.message };
  }

  // Test Pendle
  try {
    const chains = [
      { id: 1, name: 'Ethereum' },
      { id: 42161, name: 'Arbitrum' },
      { id: 10, name: 'Optimism' }
    ];

    let totalCount = 0;
    const chainResults = {};

    for (const chain of chains) {
      try {
        const data = await fetchWithRetry(`https://api-v2.pendle.finance/core/v1/${chain.id}/markets`);
        const count = data.results?.filter(m => {
          const symbol = m.underlyingAsset?.symbol || m.pt?.symbol || '';
          const hasUSD = symbol.toUpperCase().includes('USD') || 
                         symbol.toUpperCase().includes('DAI') ||
                         symbol.toUpperCase().includes('USDC') ||
                         symbol.toUpperCase().includes('USDT');
          const hasLiquidity = (m.totalActiveLiquidity || 0) > 10000;
          return hasUSD && hasLiquidity;
        }).length || 0;
        totalCount += count;
        chainResults[chain.name] = count;
      } catch (err) {
        chainResults[chain.name] = `error: ${err.message}`;
      }
    }

    results.pendle = { status: 'success', count: totalCount, byChain: chainResults };
  } catch (err) {
    results.pendle = { status: 'error', error: err.message };
  }

  // Manual data count
  results.manual = { status: 'success', count: 14 };

  // Calculate totals
  const summary = {
    totalYields: Object.values(results).reduce((sum, r) => sum + (r.count || 0), 0),
    successfulSources: Object.values(results).filter(r => r.status === 'success').length,
    failedSources: Object.values(results).filter(r => r.status === 'error').length,
    sources: Object.keys(results).length
  };

  return { results, summary };
}

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-cache');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const startTime = Date.now();
    const diagnostics = await testAPIs();
    const elapsed = Date.now() - startTime;

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      executionTime: `${elapsed}ms`,
      ...diagnostics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
