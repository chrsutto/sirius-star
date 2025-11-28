// Vercel Serverless Function for Yield Data
// Endpoint: /api/yields

// Helper function to fetch with retry
async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, i)));
    }
  }
}

// Fetch DeFi Llama yields
async function fetchDefiLlamaYields() {
  try {
    const data = await fetchWithRetry('https://yields.llama.fi/pools');
    
    const stablecoinYields = data.data
      .filter(pool => 
        pool.stablecoin === true && 
        pool.tvlUsd > 100000 &&  // $100K+ TVL filter
        pool.apy < 200 // Filter suspicious APYs
      )
      .slice(0, 50)  // Increased from 30 to 50
      .map(pool => ({
        protocol: pool.project,
        stablecoin: pool.symbol,
        chain: pool.chain,
        apy: parseFloat(pool.apy.toFixed(2)),
        tvl: pool.tvlUsd,
        apyBase: pool.apyBase || 0,
        apyReward: pool.apyReward || 0,
        type: categorizeProtocol(pool.project),
        source: 'defillama',
        url: `https://defillama.com/yields?token=${pool.symbol}&chain=${pool.chain}`,
        updatedAt: new Date().toISOString()
      }));

    return stablecoinYields;
  } catch (error) {
    console.error('DeFi Llama fetch error:', error);
    return [];
  }
}

// Fetch Pendle yields
async function fetchPendleYields() {
  try {
    const chains = [
      { id: 1, name: 'Ethereum' },
      { id: 42161, name: 'Arbitrum' }
    ];

    const allYields = [];

    for (const chain of chains) {
      try {
        const data = await fetchWithRetry(
          `https://api-v2.pendle.finance/core/v1/${chain.id}/markets`
        );

        if (data.results) {
          data.results
            .filter(market => 
              market.underlyingAsset.symbol.includes('USD') &&
              market.totalActiveLiquidity > 100000  // $100K+ TVL filter
            )
            .slice(0, 20)  // Increased from 5 to 20
            .forEach(market => {
              allYields.push({
                protocol: `Pendle ${market.pt.symbol}`,
                stablecoin: market.underlyingAsset.symbol,
                chain: chain.name,
                apy: parseFloat((market.impliedApy * 100).toFixed(2)),
                tvl: market.totalActiveLiquidity,
                type: 'Fixed Yield',
                source: 'pendle',
                maturity: market.expiry,
                url: `https://app.pendle.finance/`,
                updatedAt: new Date().toISOString()
              });
            });
        }
      } catch (error) {
        console.error(`Pendle ${chain.name} fetch error:`, error);
      }
    }

    return allYields;
  } catch (error) {
    console.error('Pendle fetch error:', error);
    return [];
  }
}

// Fetch Morpho vaults
async function fetchMorphoVaults() {
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

    if (!response.ok) {
      throw new Error(`Morpho API returned ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data.vaultV2s || !data.data.vaultV2s.items) {
      console.error('Morpho API unexpected response');
      return [];
    }
    
    // Expanded stablecoin filter
    const stablecoins = ['USDC', 'USDT', 'DAI', 'USDS', 'PYUSD', 'FRAX', 'LUSD', 'GUSD', 'USDC.e'];
    
    return data.data.vaultV2s.items
      .filter(v => v.totalAssetsUsd > 100000)  // $100K+ TVL filter
      .filter(v => stablecoins.includes(v.asset.symbol))
      .map(v => ({
        protocol: v.name,
        stablecoin: v.asset.symbol,
        chain: v.chain.network === 'ethereum' ? 'Ethereum' : v.chain.network === 'base' ? 'Base' : v.chain.network,
        apy: parseFloat((v.avgNetApy * 100).toFixed(2)),
        tvl: parseInt(v.totalAssetsUsd),
        type: 'Lending',
        source: 'morpho',
        description: `Morpho curated vault: ${v.name}`,
        url: `https://app.morpho.org/${v.chain.network}/vault/${v.address}`,
        updatedAt: new Date().toISOString()
      }));
  } catch (error) {
    console.error('Morpho API error:', error);
    return [];
  }
}

// Fetch Euler vaults via DeFi Llama
async function fetchEulerYields() {
  try {
    const response = await fetch('https://yields.llama.fi/pools');
    const data = await response.json();
    
    const eulerPools = data.data.filter(pool => 
      (pool.project === 'euler-v2' || pool.project === 'euler') &&
      pool.tvlUsd > 100000 &&  // $100K+ TVL filter
      pool.apy < 200
    );
    
    return eulerPools
      .filter(p => {
        const symbol = p.symbol.toUpperCase();
        return symbol.includes('USDC') || symbol.includes('USDT') || 
               symbol.includes('DAI') || symbol.includes('USDS') ||
               symbol.includes('PYUSD') || symbol.includes('FRAX') || symbol.includes('LUSD');
      })
      .map(p => ({
        protocol: `Euler ${p.symbol}`,
        stablecoin: extractStablecoin(p.symbol),
        chain: p.chain || 'Ethereum',
        apy: parseFloat(p.apy.toFixed(2)),
        tvl: parseInt(p.tvlUsd),
        type: 'Lending',
        source: 'euler',
        description: `Euler vault for ${p.symbol}`,
        url: `https://app.euler.finance/?network=${(p.chain || 'ethereum').toLowerCase()}`,
        updatedAt: p.timestamp || new Date().toISOString()
      }));
  } catch (error) {
    console.error('Euler API error:', error);
    return [];
  }
}

// Helper to extract stablecoin from symbol
function extractStablecoin(symbol) {
  const upper = symbol.toUpperCase();
  if (upper.includes('USDC')) return 'USDC';
  if (upper.includes('USDT')) return 'USDT';
  if (upper.includes('DAI')) return 'DAI';
  if (upper.includes('USDS')) return 'USDS';
  if (upper.includes('PYUSD')) return 'PYUSD';
  if (upper.includes('FRAX')) return 'FRAX';
  if (upper.includes('LUSD')) return 'LUSD';
  if (upper.includes('GUSD')) return 'GUSD';
  return 'USDC';
}

// Get manual data
function getManualYieldData() {
  return [
    {
      protocol: 'Sky Savings Rate (sUSDS)',
      stablecoin: 'USDS',
      chain: 'Multi-chain',
      apy: 4.5,
      tvl: 4000000000,
      type: 'Savings',
      source: 'sky',
      description: 'Non-custodial savings on USDS (formerly MakerDAO)',
      url: 'https://sky.money/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Sky DSR (sDAI)',
      stablecoin: 'DAI',
      chain: 'Ethereum',
      apy: 2.25,
      tvl: 350000000,
      type: 'Savings',
      source: 'sky',
      description: 'DAI Savings Rate',
      url: 'https://sky.money/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Midas mTBILL',
      stablecoin: 'USDC',
      chain: 'Ethereum',
      apy: 5.25,
      tvl: 45000000,
      type: 'RWA',
      source: 'midas',
      description: 'BlackRock Treasury Bond backed',
      url: 'https://midas.app/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Gauntlet USD Alpha',
      stablecoin: 'USDC',
      chain: 'Multi-chain',
      apy: 8.5,
      tvl: 250000000,
      type: 'Risk-Managed',
      source: 'gauntlet',
      description: 'Institutional-grade risk-adjusted yield',
      url: 'https://www.gauntlet.xyz/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'YieldFi yUSD',
      stablecoin: 'USDC/USDT',
      chain: 'Multi-chain',
      apy: 23.5,
      tvl: 121000000,
      type: 'Multi-Strategy',
      source: 'yieldfi',
      description: 'Professional asset management',
      url: 'https://yield.fi/',
      updatedAt: new Date().toISOString()
    }
  ];
}

// Helper function to categorize protocols
function categorizeProtocol(name) {
  const categories = {
    lending: ['aave', 'compound', 'morpho', 'euler', 'spark'],
    dex: ['uniswap', 'curve', 'balancer', 'velodrome'],
  };

  const lowerName = name.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return category.charAt(0).toUpperCase() + category.slice(1);
    }
  }
  
  return 'Other';
}

// Main serverless handler
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');

  // Handle OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow GET requests
  if (req.method !== 'GET') {
    res.status(405).json({
      success: false,
      error: 'Method not allowed'
    });
    return;
  }

  try {
    // Fetch data from all sources in parallel
    const [defiLlama, pendle, morpho, euler, manual] = await Promise.allSettled([
      fetchDefiLlamaYields(),
      fetchPendleYields(),
      fetchMorphoVaults(),
      fetchEulerYields(),
      Promise.resolve(getManualYieldData())
    ]);

    // Combine all yields
    const allYields = [
      ...(defiLlama.status === 'fulfilled' ? defiLlama.value : []),
      ...(pendle.status === 'fulfilled' ? pendle.value : []),
      ...(morpho.status === 'fulfilled' ? morpho.value : []),
      ...(euler.status === 'fulfilled' ? euler.value : []),
      ...(manual.status === 'fulfilled' ? manual.value : [])
    ];

    // Calculate statistics
    const stats = {
      totalOpportunities: allYields.length,
      totalTVL: allYields.reduce((sum, y) => sum + y.tvl, 0),
      avgAPY: allYields.length > 0 
        ? allYields.reduce((sum, y) => sum + y.apy, 0) / allYields.length 
        : 0,
      maxAPY: allYields.length > 0 ? Math.max(...allYields.map(y => y.apy)) : 0,
      minAPY: allYields.length > 0 ? Math.min(...allYields.map(y => y.apy)) : 0,
      sources: [...new Set(allYields.map(y => y.source))],
      chains: [...new Set(allYields.map(y => y.chain))],
      morphoVaults: morpho.status === 'fulfilled' ? morpho.value.length : 0,
      eulerVaults: euler.status === 'fulfilled' ? euler.value.length : 0,
      updatedAt: new Date().toISOString()
    };

    // Return successful response
    res.status(200).json({
      success: true,
      data: allYields,
      stats: stats
    });

  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch yield data',
      message: error.message
    });
  }
}
