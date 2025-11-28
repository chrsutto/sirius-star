// Stablecoin Yield Aggregator Backend
// Node.js + Express server for aggregating yield data from multiple DeFi sources

const express = require('express');
const cors = require('cors');
const NodeCache = require('node-cache');
const path = require('path');

// Fetch polyfill for older Node versions
const fetch = globalThis.fetch || require('node-fetch');

const app = express();
const cache = new NodeCache({ stdTTL: 300 }); // 5 minute cache

app.use(cors());
app.use(express.json());

// Serve static files (for CSS, JS, images, etc.)
app.use(express.static(__dirname));

// Serve the dashboard HTML at root
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'stablecoin-yield-dashboard.html'));
});

// ============================================================================
// DATA FETCHING FUNCTIONS
// ============================================================================

/**
 * Fetch stablecoin yields from DeFi Llama
 */
async function fetchDefiLlamaYields() {
  try {
    const cached = cache.get('defillama');
    if (cached) return cached;

    const response = await fetch('https://yields.llama.fi/pools');
    const data = await response.json();
    
    const stablecoinYields = data.data
      .filter(pool => 
        pool.stablecoin === true && 
        pool.tvlUsd > 100000 &&  // $100K+ TVL filter (lowered from $1M)
        pool.apy < 200 // Filter out suspicious APYs
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

    cache.set('defillama', stablecoinYields);
    return stablecoinYields;
  } catch (error) {
    console.error('DeFi Llama fetch error:', error);
    return [];
  }
}

/**
 * Fetch yields from Pendle Finance
 */
async function fetchPendleYields() {
  try {
    const cached = cache.get('pendle');
    if (cached) return cached;

    const chains = [
      { id: 1, name: 'Ethereum' },
      { id: 42161, name: 'Arbitrum' },
      { id: 10, name: 'Optimism' }
    ];

    const allYields = [];

    for (const chain of chains) {
      try {
        const response = await fetch(
          `https://api-v2.pendle.finance/core/v1/${chain.id}/markets`
        );
        const data = await response.json();

        if (data.results) {
          data.results
            .filter(market => 
              market.underlyingAsset.symbol.includes('USD') &&
              market.totalActiveLiquidity > 100000  // $100K+ TVL filter (lowered from $1M)
            )
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
                url: `https://app.pendle.finance/trade/markets/${market.address}/${chain.id}`,
                updatedAt: new Date().toISOString()
              });
            });
        }
      } catch (error) {
        console.error(`Pendle ${chain.name} fetch error:`, error);
      }
    }

    cache.set('pendle', allYields);
    return allYields;
  } catch (error) {
    console.error('Pendle fetch error:', error);
    return [];
  }
}

/**
 * Fetch opportunities from Merkl
 */
async function fetchMerklYields() {
  try {
    const cached = cache.get('merkl');
    if (cached) return cached;

    const chains = [1, 8453, 42161]; // Ethereum, Base, Arbitrum
    const allYields = [];

    for (const chainId of chains) {
      try {
        const response = await fetch(
          `https://api.merkl.xyz/v3/opportunities?chainId=${chainId}`
        );
        const data = await response.json();

        if (data.data) {
          data.data
            .filter(opp => 
              opp.tokenSymbol && 
              opp.tokenSymbol.includes('USD') &&
              opp.tvl > 100000  // $100K+ TVL filter (lowered from $1M)
            )
            .slice(0, 20)  // Increased from 10 to 20
            .forEach(opp => {
              allYields.push({
                protocol: `Merkl ${opp.name}`,
                stablecoin: opp.tokenSymbol,
                chain: opp.chainName || getChainName(chainId),
                apy: parseFloat(opp.apr.toFixed(2)),
                tvl: opp.tvl,
                type: 'Incentivized',
                source: 'merkl',
                url: `https://merkl.angle.money/`,
                updatedAt: new Date().toISOString()
              });
            });
        }
      } catch (error) {
        console.error(`Merkl chain ${chainId} fetch error:`, error);
      }
    }

    cache.set('merkl', allYields);
    return allYields;
  } catch (error) {
    console.error('Merkl fetch error:', error);
    return [];
  }
}

// ============================================================================
// MORPHO & EULER INTEGRATION
// ============================================================================

/**
 * Fetch Morpho vaults from GraphQL API
 */
async function fetchMorphoVaults() {
  try {
    const cached = cache.get('morpho');
    if (cached) return cached;

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
      throw new Error(`Morpho API returned ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    
    if (!data.data || !data.data.vaultV2s || !data.data.vaultV2s.items) {
      console.error('Morpho API unexpected response:', JSON.stringify(data).substring(0, 200));
      throw new Error('Morpho API returned unexpected data structure');
    }
    
    console.log(`📥 Morpho: Received ${data.data.vaultV2s.items.length} total vaults from API`);
    
    const afterTvlFilter = data.data.vaultV2s.items.filter(v => v.totalAssetsUsd > 100000);
    console.log(`💰 Morpho: ${afterTvlFilter.length} vaults after TVL filter (>$100K)`);
    
    // Expanded stablecoin filter to include more assets
    const stablecoins = ['USDC', 'USDT', 'DAI', 'USDS', 'PYUSD', 'FRAX', 'LUSD', 'GUSD', 'USDC.e'];
    const morphoYields = afterTvlFilter
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

    console.log(`✅ Morpho: ${morphoYields.length} stablecoin vaults (from ${stablecoins.join(', ')})`);
    cache.set('morpho', morphoYields);
    return morphoYields;
  } catch (error) {
    console.error('❌ Morpho API error:', error.message);
    console.error('   Stack:', error.stack);
    return [];
  }
}

/**
 * Fetch Euler vaults via DeFi Llama API
 */
async function fetchEulerYields() {
  try {
    const cached = cache.get('euler');
    if (cached) return cached;

    const response = await fetch('https://yields.llama.fi/pools');
    
    if (!response.ok) {
      throw new Error(`DeFi Llama API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.data || !Array.isArray(data.data)) {
      console.error('DeFi Llama unexpected response:', JSON.stringify(data).substring(0, 200));
      throw new Error('DeFi Llama API returned unexpected data structure');
    }
    
    const eulerPools = data.data.filter(pool => 
      (pool.project === 'euler-v2' || pool.project === 'euler') &&
      pool.tvlUsd > 100000 &&  // $100K+ TVL filter (lowered from $500K)
      pool.apy < 200
    );
    
    console.log(`📥 Euler: Found ${eulerPools.length} Euler pools from DeFi Llama`);
    
    const eulerYields = eulerPools
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

    console.log(`✅ Euler: ${eulerYields.length} stablecoin vaults`);
    console.log(`✅ Euler: Fetched ${eulerYields.length} vaults`);
    cache.set('euler', eulerYields);
    return eulerYields;
  } catch (error) {
    console.error('❌ Euler API error:', error.message);
    console.error('   Stack:', error.stack);
    return [];
  }
}

/**
 * Helper function to extract stablecoin from symbol
 */
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
  return 'USDC'; // default
}

/**
 * Get manual data for protocols without public APIs
 */
function getManualYieldData() {
  return [
    // Sky Protocol (formerly MakerDAO)
    {
      protocol: 'Sky Savings Rate (sUSDS)',
      stablecoin: 'USDS',
      chain: 'Multi-chain',
      apy: 4.5,
      tvl: 4000000000,
      type: 'Savings',
      source: 'sky',
      description: 'Non-custodial savings rate on USDS stablecoin (formerly MakerDAO DSR)',
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
      description: 'DAI Savings Rate - original MakerDAO savings product',
      url: 'https://sky.money/',
      updatedAt: new Date().toISOString()
    },
    
    // Midas Protocol
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
      protocol: 'Midas mBASIS',
      stablecoin: 'USDC',
      chain: 'Ethereum',
      apy: 12.5,
      tvl: 28000000,
      type: 'Basis Trade',
      source: 'midas',
      description: 'Cash & carry basis trade strategy',
      url: 'https://midas.app/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Midas mEDGE',
      stablecoin: 'USDC',
      chain: 'Ethereum',
      apy: 8.5,
      tvl: 12000000,
      type: 'Delta Neutral',
      source: 'midas',
      description: 'Edge Capital delta-neutral DeFi yields',
      url: 'https://midas.app/',
      updatedAt: new Date().toISOString()
    },
    
    // Gauntlet
    {
      protocol: 'Gauntlet USD Alpha',
      stablecoin: 'USDC',
      chain: 'Multi-chain',
      apy: 8.5,
      tvl: 250000000,
      type: 'Risk-Managed',
      source: 'gauntlet',
      description: 'Institutional-grade risk-adjusted yield',
      url: 'https://www.gauntlet.xyz/gauntlet-strategies/gtusda',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Gauntlet Prime USDC',
      stablecoin: 'USDC',
      chain: 'Ethereum',
      apy: 6.8,
      tvl: 180000000,
      type: 'Conservative',
      source: 'gauntlet',
      description: 'Low-risk conservative vault',
      url: 'https://www.gauntlet.xyz/',
      updatedAt: new Date().toISOString()
    },

    // Noon Capital
    {
      protocol: 'Noon USN',
      stablecoin: 'USDC/USDT',
      chain: 'Ethereum',
      apy: 14.5,
      tvl: 33000000,
      type: 'Delta Neutral',
      source: 'noon',
      description: 'Intelligent yield allocation across strategies',
      url: 'https://noon.capital/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Noon sUSN',
      stablecoin: 'USN',
      chain: 'Ethereum',
      apy: 17.5,
      tvl: 28000000,
      type: 'Staked',
      source: 'noon',
      description: 'Staked yield-generating stablecoin',
      url: 'https://app.noon.capital/',
      updatedAt: new Date().toISOString()
    },

    // YieldFi
    {
      protocol: 'YieldFi yUSD',
      stablecoin: 'USDC/USDT',
      chain: 'Multi-chain',
      apy: 23.5,
      tvl: 121000000,
      type: 'Multi-Strategy',
      source: 'yieldfi',
      description: 'Professional asset management platform',
      url: 'https://yield.fi/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'YieldFi vyUSD',
      stablecoin: 'yUSD',
      chain: 'Multi-chain',
      apy: 16.0,
      tvl: 45000000,
      type: 'Vault',
      source: 'yieldfi',
      description: 'Vaulted yUSD with boosted rewards',
      url: 'https://yield.fi/',
      updatedAt: new Date().toISOString()
    },

    // Avant Protocol
    {
      protocol: 'Avant avUSD',
      stablecoin: 'USDC/USDT',
      chain: 'Avalanche',
      apy: 15.8,
      tvl: 89000000,
      type: 'Delta Neutral',
      source: 'avant',
      description: 'Market-neutral yield strategies',
      url: 'https://www.avantprotocol.com/',
      updatedAt: new Date().toISOString()
    },
    {
      protocol: 'Avant savUSD',
      stablecoin: 'avUSD',
      chain: 'Avalanche',
      apy: 18.2,
      tvl: 67000000,
      type: 'Staked',
      source: 'avant',
      description: 'Staked yield-bearing avUSD',
      url: 'https://www.avantprotocol.com/',
      updatedAt: new Date().toISOString()
    },

    // Gyroscope Protocol
    {
      protocol: 'Gyroscope GYD',
      stablecoin: 'Multi-collateral',
      chain: 'Ethereum',
      apy: 10.8,
      tvl: 125000000,
      type: 'Superliquid',
      source: 'gyroscope',
      description: 'Most efficient stablecoin liquidity',
      url: 'https://www.gyro.finance/',
      updatedAt: new Date().toISOString()
    }
  ];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function categorizeProtocol(name) {
  const categories = {
    lending: ['aave', 'compound', 'morpho', 'euler', 'spark'],
    dex: ['uniswap', 'curve', 'balancer', 'velodrome'],
    liquid_staking: ['lido', 'rocket', 'frax'],
    rwa: ['ondo', 'maple', 'centrifuge']
  };

  const lowerName = name.toLowerCase();
  
  for (const [category, keywords] of Object.entries(categories)) {
    if (keywords.some(keyword => lowerName.includes(keyword))) {
      return category.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  }
  
  return 'Other';
}

function getChainName(chainId) {
  const chains = {
    1: 'Ethereum',
    42161: 'Arbitrum',
    10: 'Optimism',
    137: 'Polygon',
    8453: 'Base',
    43114: 'Avalanche',
    324: 'zkSync'
  };
  return chains[chainId] || 'Unknown';
}

// ============================================================================
// API ROUTES
// ============================================================================

/**
 * GET /api/yields - Get all yield opportunities
 */
app.get('/api/yields', async (req, res) => {
  try {
    const [defiLlama, pendle, merkl, morpho, euler, manual] = await Promise.allSettled([
      fetchDefiLlamaYields(),
      fetchPendleYields(),
      fetchMerklYields(),
      fetchMorphoVaults(),
      fetchEulerYields(),
      Promise.resolve(getManualYieldData())
    ]);

    const allYields = [
      ...(defiLlama.status === 'fulfilled' ? defiLlama.value : []),
      ...(pendle.status === 'fulfilled' ? pendle.value : []),
      ...(merkl.status === 'fulfilled' ? merkl.value : []),
      ...(morpho.status === 'fulfilled' ? morpho.value : []),
      ...(euler.status === 'fulfilled' ? euler.value : []),
      ...(manual.status === 'fulfilled' ? manual.value : [])
    ];

    // Calculate statistics
    const stats = {
      totalOpportunities: allYields.length,
      totalTVL: allYields.reduce((sum, y) => sum + y.tvl, 0),
      avgAPY: allYields.reduce((sum, y) => sum + y.apy, 0) / allYields.length,
      maxAPY: Math.max(...allYields.map(y => y.apy)),
      minAPY: Math.min(...allYields.map(y => y.apy)),
      sources: [...new Set(allYields.map(y => y.source))],
      chains: [...new Set(allYields.map(y => y.chain))],
      morphoVaults: morpho.status === 'fulfilled' ? morpho.value.length : 0,
      eulerVaults: euler.status === 'fulfilled' ? euler.value.length : 0,
      updatedAt: new Date().toISOString()
    };

    res.json({
      success: true,
      data: allYields,
      stats: stats
    });
  } catch (error) {
    console.error('API error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch yield data'
    });
  }
});

/**
 * GET /api/yields/top - Get top yields by APY
 */
app.get('/api/yields/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const response = await fetch(`http://localhost:${PORT}/api/yields`);
    const data = await response.json();
    
    const topYields = data.data
      .sort((a, b) => b.apy - a.apy)
      .slice(0, limit);

    res.json({
      success: true,
      data: topYields
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch top yields'
    });
  }
});

/**
 * GET /api/yields/filter - Filter yields by criteria
 */
app.get('/api/yields/filter', async (req, res) => {
  try {
    const { chain, stablecoin, minAPY, maxAPY, source } = req.query;
    
    const response = await fetch(`http://localhost:${PORT}/api/yields`);
    const data = await response.json();
    
    let filtered = data.data;

    if (chain) {
      filtered = filtered.filter(y => y.chain.toLowerCase() === chain.toLowerCase());
    }
    if (stablecoin) {
      filtered = filtered.filter(y => 
        y.stablecoin.toLowerCase().includes(stablecoin.toLowerCase())
      );
    }
    if (minAPY) {
      filtered = filtered.filter(y => y.apy >= parseFloat(minAPY));
    }
    if (maxAPY) {
      filtered = filtered.filter(y => y.apy <= parseFloat(maxAPY));
    }
    if (source) {
      filtered = filtered.filter(y => y.source === source);
    }

    res.json({
      success: true,
      data: filtered,
      count: filtered.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to filter yields'
    });
  }
});

/**
 * GET /api/stats - Get aggregated statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const response = await fetch(`http://localhost:${PORT}/api/yields`);
    const data = await response.json();
    
    res.json({
      success: true,
      stats: data.stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics'
    });
  }
});

/**
 * GET /health - Health check endpoint
 */
/**
 * GET /api/clear-cache - Clear all cached data
 */
app.get('/api/clear-cache', (req, res) => {
  cache.flushAll();
  console.log('🗑️  Cache cleared - all data will be refetched on next request');
  res.json({
    success: true,
    message: 'Cache cleared successfully',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/debug - Debug endpoint to check API sources
 */
app.get('/api/debug', async (req, res) => {
  console.log('🔍 Running debug diagnostics...');
  
  const results = {
    timestamp: new Date().toISOString(),
    sources: {}
  };

  // Test DeFi Llama
  try {
    const defiLlama = await fetchDefiLlamaYields();
    results.sources.defiLlama = {
      status: 'success',
      count: defiLlama.length,
      sample: defiLlama.slice(0, 2)
    };
    console.log(`✅ DeFi Llama: ${defiLlama.length} yields`);
  } catch (error) {
    results.sources.defiLlama = {
      status: 'error',
      error: error.message
    };
    console.log(`❌ DeFi Llama failed: ${error.message}`);
  }

  // Test Pendle
  try {
    const pendle = await fetchPendleYields();
    results.sources.pendle = {
      status: 'success',
      count: pendle.length,
      sample: pendle.slice(0, 2)
    };
    console.log(`✅ Pendle: ${pendle.length} yields`);
  } catch (error) {
    results.sources.pendle = {
      status: 'error',
      error: error.message
    };
    console.log(`❌ Pendle failed: ${error.message}`);
  }

  // Test Merkl
  try {
    const merkl = await fetchMerklYields();
    results.sources.merkl = {
      status: 'success',
      count: merkl.length,
      sample: merkl.slice(0, 2)
    };
    console.log(`✅ Merkl: ${merkl.length} yields`);
  } catch (error) {
    results.sources.merkl = {
      status: 'error',
      error: error.message
    };
    console.log(`❌ Merkl failed: ${error.message}`);
  }

  // Test Morpho
  try {
    const morpho = await fetchMorphoVaults();
    results.sources.morpho = {
      status: 'success',
      count: morpho.length,
      sample: morpho.slice(0, 2)
    };
    console.log(`✅ Morpho: ${morpho.length} vaults`);
  } catch (error) {
    results.sources.morpho = {
      status: 'error',
      error: error.message
    };
    console.log(`❌ Morpho failed: ${error.message}`);
  }

  // Test Euler
  try {
    const euler = await fetchEulerYields();
    results.sources.euler = {
      status: 'success',
      count: euler.length,
      sample: euler.slice(0, 2)
    };
    console.log(`✅ Euler: ${euler.length} vaults`);
  } catch (error) {
    results.sources.euler = {
      status: 'error',
      error: error.message
    };
    console.log(`❌ Euler failed: ${error.message}`);
  }

  // Test Manual
  try {
    const manual = getManualYieldData();
    results.sources.manual = {
      status: 'success',
      count: manual.length,
      sample: manual.slice(0, 2)
    };
    console.log(`✅ Manual: ${manual.length} yields`);
  } catch (error) {
    results.sources.manual = {
      status: 'error',
      error: error.message
    };
    console.log(`❌ Manual failed: ${error.message}`);
  }

  // Calculate totals
  results.summary = {
    totalSources: Object.keys(results.sources).length,
    successfulSources: Object.values(results.sources).filter(s => s.status === 'success').length,
    failedSources: Object.values(results.sources).filter(s => s.status === 'error').length,
    totalYields: Object.values(results.sources)
      .filter(s => s.status === 'success')
      .reduce((sum, s) => sum + s.count, 0)
  };

  console.log(`\n📊 Total: ${results.summary.totalYields} yields from ${results.summary.successfulSources}/${results.summary.totalSources} sources\n`);

  res.json(results);
});

/**
 * GET /health - Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// ============================================================================
// SERVER INITIALIZATION
// ============================================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════╗
║  Stablecoin Yield Aggregator API Server              ║
║  Running on port ${PORT}                                ║
║                                                       ║
║  Endpoints:                                           ║
║  GET /api/yields         - All yield opportunities    ║
║  GET /api/yields/top     - Top yields by APY          ║
║  GET /api/yields/filter  - Filter yields              ║
║  GET /api/stats          - Aggregated statistics      ║
║  GET /health             - Health check               ║
║                                                       ║
║  Data Sources:                                        ║
║  • DeFi Llama  • Pendle  • Merkl                     ║
║  • Midas  • Gauntlet  • Noon  • YieldFi              ║
║  • Avant  • Gyroscope                                ║
╚═══════════════════════════════════════════════════════╝
  `);
});

// ============================================================================
// PACKAGE.JSON DEPENDENCIES
// ============================================================================

/*
{
  "name": "stablecoin-yield-aggregator",
  "version": "1.0.0",
  "description": "Backend API for aggregating stablecoin yields from multiple DeFi sources",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "cors": "^2.8.5",
    "node-cache": "^5.1.2",
    "node-fetch": "^2.6.7"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
*/
