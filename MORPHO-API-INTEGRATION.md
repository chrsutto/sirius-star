# 🔷 Morpho Vaults API Integration Guide

## Overview

This guide shows you how to integrate real-time Morpho vault data into your stablecoin yield aggregator using Morpho's GraphQL API.

---

## 📊 Morpho Vaults Overview

**What are Morpho Vaults?**
- Curated lending vaults that optimize yields across multiple markets
- Permissionless creation - anyone can deploy a vault
- Managed by professional curators (Gauntlet, Steakhouse, etc.)
- Typically **2-16% APY** on stablecoins (USDC, USDT, DAI)

**Key Stats:**
- **100+ vaults** across Ethereum and Base
- **$7B+ TVL** in Morpho protocol
- Assets: USDC, USDT, WETH, DAI, and more
- Real-time APY updates based on market conditions

---

## 🔌 Morpho GraphQL API

### **API Endpoint**
```
https://blue-api.morpho.org/graphql
```

### **Authentication**
No API key required - public endpoint

###

 **Rate Limits**
- 100 results per query by default
- Use pagination for larger datasets

---

## 📝 Example GraphQL Queries

### **Query 1: Get All Vaults (Ethereum)**

```graphql
query GetMorphoVaults {
  vaultV2s(
    first: 100
    where: { chainId_in: [1], whitelisted: true }
  ) {
    items {
      address
      name
      symbol
      whitelisted
      asset {
        address
        symbol
        decimals
      }
      totalAssetsUsd
      avgNetApy
      chain {
        id
        network
      }
    }
  }
}
```

### **Query 2: Get Vault Details with APY**

```graphql
query GetVaultDetails($address: String!, $chainId: Int!) {
  vaultV2ByAddress(
    address: $address
    chainId: $chainId
  ) {
    address
    name
    symbol
    totalAssets
    totalAssetsUsd
    totalSupply
    avgApy
    avgNetApy
    performanceFee
    managementFee
    asset {
      symbol
      address
      yield {
        apr
      }
    }
    rewards {
      asset {
        address
        symbol
      }
      supplyApr
      yearlySupplyTokens
    }
  }
}
```

### **Query 3: Get Top Vaults by TVL**

```graphql
query GetTopVaults {
  vaultV2s(
    first: 20
    where: { chainId_in: [1], whitelisted: true }
    orderBy: totalAssetsUsd
    orderDirection: desc
  ) {
    items {
      name
      symbol
      totalAssetsUsd
      avgNetApy
      asset {
        symbol
      }
    }
  }
}
```

---

## 💻 JavaScript Implementation

### **Using Fetch API**

```javascript
async function fetchMorphoVaults() {
  const query = `
    query {
      vaultV2s(
        first: 100
        where: { chainId_in: [1], whitelisted: true }
      ) {
        items {
          address
          name
          symbol
          totalAssetsUsd
          avgNetApy
          asset {
            symbol
          }
          chain {
            network
          }
        }
      }
    }
  `;

  try {
    const response = await fetch('https://blue-api.morpho.org/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    });

    const data = await response.json();
    return data.data.vaultV2s.items;
  } catch (error) {
    console.error('Error fetching Morpho vaults:', error);
    return [];
  }
}
```

### **Transform Data for Dashboard**

```javascript
function transformMorphoData(vaults) {
  return vaults
    .filter(vault => vault.totalAssetsUsd > 1000000) // Filter by $1M+ TVL
    .map(vault => ({
      protocol: vault.name,
      stablecoin: vault.asset.symbol,
      chain: vault.chain.network === 'ethereum' ? 'Ethereum' : 'Base',
      apy: parseFloat((vault.avgNetApy * 100).toFixed(2)), // Convert to percentage
      tvl: parseInt(vault.totalAssetsUsd),
      type: 'Lending',
      source: 'morpho',
      description: `Morpho curated vault: ${vault.name}`,
      url: `https://app.morpho.org/${vault.chain.network}/vault/${vault.address}`,
      updatedAt: new Date().toISOString()
    }));
}
```

### **Complete Integration Example**

```javascript
async function getMorphoYieldData() {
  try {
    // Fetch vaults
    const vaults = await fetchMorphoVaults();
    
    // Transform for dashboard
    const yields = transformMorphoData(vaults);
    
    // Filter stablecoin vaults only
    const stablecoinYields = yields.filter(y => 
      ['USDC', 'USDT', 'DAI', 'USDS'].includes(y.stablecoin)
    );
    
    console.log(`Found ${stablecoinYields.length} Morpho stablecoin vaults`);
    return stablecoinYields;
    
  } catch (error) {
    console.error('Morpho integration error:', error);
    return [];
  }
}

// Usage
getMorphoYieldData().then(yields => {
  console.log('Morpho Yields:', yields);
  // Add to your dashboard data
});
```

---

## 🎯 Understanding Morpho APY Components

### **APY Breakdown:**

```
Net APY = Native APY + Underlying Token Yield + Rewards APR - Performance Fee - Management Fee
```

**Components:**
1. **Native APY** (`avgApy`): Base lending yield (before fees)
2. **Underlying Token Yield**: Yield from the token itself (e.g., sDAI earns DSR)
3. **Rewards APR**: Additional incentives (MORPHO tokens, etc.)
4. **Performance Fee**: Curator's fee on profits (typically 5-15%)
5. **Management Fee**: Annual fee on assets (typically 0-2%)

**What to Use:**
- Use `avgNetApy` for the "final" APY users receive
- Multiply by 100 to convert to percentage (e.g., 0.0825 → 8.25%)

---

## 📦 Popular Morpho Vaults (Examples)

### **Top Stablecoin Vaults:**

| Vault Name | Asset | APY | TVL | Curator |
|------------|-------|-----|-----|---------|
| Gauntlet USDC Core | USDC | ~8-12% | $500M+ | Gauntlet |
| Steakhouse USDC | USDC | ~7-10% | $300M+ | Steakhouse |
| Re7 USDT Core | USDT | ~9-13% | $200M+ | Re7 Labs |
| Gauntlet WETH Prime | WETH | ~3-5% | $400M+ | Gauntlet |

*Note: APYs are variable and change based on market conditions*

---

## 🔄 Updating Vault Data

### **Recommended Update Frequency:**

```javascript
// Update every 5 minutes
setInterval(async () => {
  const freshData = await getMorphoYieldData();
  updateDashboard(freshData);
}, 5 * 60 * 1000);
```

### **Caching Strategy:**

```javascript
let morphoCache = {
  data: [],
  timestamp: null,
  ttl: 5 * 60 * 1000 // 5 minutes
};

async function getCachedMorphoData() {
  const now = Date.now();
  
  if (!morphoCache.timestamp || (now - morphoCache.timestamp) > morphoCache.ttl) {
    morphoCache.data = await getMorphoYieldData();
    morphoCache.timestamp = now;
  }
  
  return morphoCache.data;
}
```

---

## 🚀 Integration into Your Dashboard

### **server.js Integration:**

```javascript
const fetch = require('node-fetch');

async function fetchMorphoVaults() {
  const query = `{
    vaultV2s(first: 100, where: { chainId_in: [1], whitelisted: true }) {
      items {
        name
        symbol
        totalAssetsUsd
        avgNetApy
        asset { symbol }
        chain { network }
        address
      }
    }
  }`;

  const response = await fetch('https://blue-api.morpho.org/graphql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  const data = await response.json();
  return data.data.vaultV2s.items;
}

// Add to your yields endpoint
app.get('/api/yields', async (req, res) => {
  try {
    const morphoVaults = await fetchMorphoVaults();
    const morphoYields = transformMorphoData(morphoVaults);
    
    const allYields = [
      ...getManualYieldData(), // Your existing manual data
      ...morphoYields // Dynamic Morpho data
    ];
    
    res.json({ yields: allYields });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch yields' });
  }
});
```

---

## 🧪 Testing Your Integration

### **Test Query:**

```bash
curl -X POST https://blue-api.morpho.org/graphql \
  -H "Content-Type: application/json" \
  -d '{
    "query": "{ vaultV2s(first: 5, where: { chainId_in: [1] }) { items { name avgNetApy } } }"
  }'
```

### **Expected Response:**

```json
{
  "data": {
    "vaultV2s": {
      "items": [
        {
          "name": "Gauntlet USDC Core",
          "avgNetApy": 0.0825
        },
        ...
      ]
    }
  }
}
```

---

## 🎨 Display in Dashboard

### **Add Morpho Badge Color:**

```javascript
function getProtocolColor(source) {
  const colors = {
    'morpho': 'bg-blue-100 text-blue-800',
    // ... other protocols
  };
  return colors[source] || 'bg-gray-100 text-gray-700';
}
```

### **Filter by Curator:**

```javascript
const curators = ['All', 'Gauntlet', 'Steakhouse', 'Re7 Labs', 'Keyrock'];

// Add curator to filter options
yields.filter(y => 
  curatorFilter === 'All' || y.protocol.includes(curatorFilter)
);
```

---

## 📚 Additional Resources

**Official Links:**
- Morpho App: https://app.morpho.org/
- API Docs: https://docs.morpho.org/
- GraphQL Playground: https://blue-api.morpho.org/graphql
- DeFi Llama: https://defillama.com/protocol/morpho

**Morpho Vaults:**
- Browse vaults: https://app.morpho.org/ethereum/earn
- Vault documentation: https://docs.morpho.org/morpho-vaults/

---

## ⚠️ Important Notes

1. **Whitelisted Vaults:** Use `whitelisted: true` to get verified vaults only
2. **APY Volatility:** Morpho APYs change frequently based on utilization
3. **Multi-Chain:** Morpho has vaults on Ethereum (chainId: 1) and Base (chainId: 8453)
4. **TVL Threshold:** Consider filtering vaults with TVL > $1M for quality
5. **Performance Fees:** `avgNetApy` already accounts for all fees

---

## 🎯 Next Steps

1. ✅ Test the GraphQL queries in Morpho's playground
2. ✅ Implement the fetch function in your backend
3. ✅ Transform data to match your dashboard format
4. ✅ Add caching to reduce API calls
5. ✅ Display Morpho vaults alongside existing data
6. ✅ Add filters for curators and vault types

---

**Integration Complete!** 🎉

With this integration, your dashboard will automatically display **100+ Morpho vaults** with real-time APY data!

---

**Last Updated:** November 27, 2024  
**API Version:** Morpho Blue V2  
**Status:** Production Ready ✅
