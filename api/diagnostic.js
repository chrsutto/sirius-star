// Diagnostic endpoint that returns HTML
// Access at: /api/diagnostic

export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Yield Aggregator Diagnostics</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-100 p-8">
    <div class="max-w-4xl mx-auto">
        <h1 class="text-3xl font-bold mb-6 text-gray-800">🔍 Yield Aggregator Diagnostics</h1>
        
        <div class="bg-white rounded-lg shadow p-6 mb-6">
            <h2 class="text-xl font-semibold mb-4">Test API Sources</h2>
            <button id="testBtn" class="bg-blue-500 hover:bg-blue-600 text-white px-6 py-2 rounded">
                Run Diagnostics
            </button>
            <span id="loading" class="ml-4 hidden">Testing APIs...</span>
        </div>

        <div id="results" class="hidden">
            <!-- Summary -->
            <div class="bg-white rounded-lg shadow p-6 mb-6">
                <h2 class="text-xl font-semibold mb-4">Summary</h2>
                <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div class="text-center">
                        <div class="text-3xl font-bold text-blue-600" id="totalYields">-</div>
                        <div class="text-sm text-gray-600">Total Yields</div>
                    </div>
                    <div class="text-center">
                        <div class="text-3xl font-bold text-green-600" id="successSources">-</div>
                        <div class="text-sm text-gray-600">Working Sources</div>
                    </div>
                    <div class="text-center">
                        <div class="text-3xl font-bold text-red-600" id="failedSources">-</div>
                        <div class="text-sm text-gray-600">Failed Sources</div>
                    </div>
                    <div class="text-center">
                        <div class="text-3xl font-bold text-purple-600" id="execTime">-</div>
                        <div class="text-sm text-gray-600">Execution Time</div>
                    </div>
                </div>
            </div>

            <!-- Individual Sources -->
            <div class="bg-white rounded-lg shadow p-6">
                <h2 class="text-xl font-semibold mb-4">API Sources</h2>
                <div id="sourcesList" class="space-y-4">
                    <!-- Populated by JS -->
                </div>
            </div>

            <!-- Expected vs Actual -->
            <div class="bg-white rounded-lg shadow p-6 mt-6">
                <h2 class="text-xl font-semibold mb-4">Expected vs Actual</h2>
                <div id="comparison" class="space-y-2">
                    <!-- Populated by JS -->
                </div>
            </div>

            <!-- Recommendations -->
            <div class="bg-blue-50 border-l-4 border-blue-500 p-6 mt-6">
                <h2 class="text-xl font-semibold mb-4 text-blue-800">💡 Recommendations</h2>
                <div id="recommendations" class="space-y-2 text-blue-900">
                    <!-- Populated by JS -->
                </div>
            </div>
        </div>

        <div id="error" class="hidden bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mt-6">
            <strong>Error:</strong> <span id="errorMsg"></span>
        </div>

        <!-- Raw JSON output -->
        <div class="bg-white rounded-lg shadow p-6 mt-6">
            <h2 class="text-xl font-semibold mb-4">Raw JSON Output</h2>
            <button id="toggleJson" class="bg-gray-500 hover:bg-gray-600 text-white px-4 py-2 rounded text-sm">
                Show Raw JSON
            </button>
            <pre id="jsonOutput" class="hidden mt-4 bg-gray-800 text-green-400 p-4 rounded overflow-auto max-h-96 text-xs"></pre>
        </div>
    </div>

    <script>
        const expected = {
            defiLlama: { min: 40, max: 50 },
            morpho: { min: 25, max: 35 },
            euler: { min: 20, max: 30 },
            pendle: { min: 10, max: 30 },
            manual: { min: 24, max: 24 }  // Updated: added all Spark products (Savings + SparkLend)
        };

        let rawData = null;

        document.getElementById('testBtn').addEventListener('click', async () => {
            const loading = document.getElementById('loading');
            const results = document.getElementById('results');
            const error = document.getElementById('error');
            
            loading.classList.remove('hidden');
            results.classList.add('hidden');
            error.classList.add('hidden');
            
            try {
                const response = await fetch('/api/debug');
                const data = await response.json();
                
                rawData = data;
                document.getElementById('jsonOutput').textContent = JSON.stringify(data, null, 2);
                
                if (!data.success) {
                    throw new Error(data.error || 'Unknown error');
                }
                
                // Update summary
                document.getElementById('totalYields').textContent = data.summary.totalYields;
                document.getElementById('successSources').textContent = data.summary.successfulSources;
                document.getElementById('failedSources').textContent = data.summary.failedSources;
                document.getElementById('execTime').textContent = data.executionTime;
                
                // Update sources list
                const sourcesList = document.getElementById('sourcesList');
                sourcesList.innerHTML = '';
                
                Object.entries(data.results).forEach(([name, result]) => {
                    const div = document.createElement('div');
                    div.className = 'border-l-4 pl-4 py-2 ' + (result.status === 'success' ? 'border-green-500' : 'border-red-500');
                    
                    const statusIcon = result.status === 'success' ? '✅' : '❌';
                    const statusClass = result.status === 'success' ? 'text-green-600' : 'text-red-600';
                    
                    div.innerHTML = \`
                        <div class="flex justify-between items-center">
                            <div>
                                <span class="text-lg font-semibold">\${statusIcon} \${name.charAt(0).toUpperCase() + name.slice(1)}</span>
                                <span class="ml-4 \${statusClass}">\${result.status}</span>
                            </div>
                            <div class="text-right">
                                \${result.status === 'success' 
                                    ? \`<span class="text-2xl font-bold">\${result.count || 0}</span> yields\` 
                                    : \`<span class="text-red-600">\${result.error}</span>\`}
                            </div>
                        </div>
                        \${result.sample ? \`<div class="text-sm text-gray-600 mt-1">Sample: \${result.sample}</div>\` : ''}
                        \${result.total ? \`<div class="text-sm text-gray-600">Total available: \${result.total}</div>\` : ''}
                        \${result.byChain ? \`<div class="text-sm text-gray-600 mt-1">By chain: \${JSON.stringify(result.byChain)}</div>\` : ''}
                    \`;
                    sourcesList.appendChild(div);
                });
                
                // Update comparison
                const comparison = document.getElementById('comparison');
                comparison.innerHTML = '';
                
                Object.entries(data.results).forEach(([name, result]) => {
                    const exp = expected[name];
                    if (!exp) return;
                    
                    const actual = result.count || 0;
                    const isGood = actual >= exp.min && actual <= exp.max;
                    const isTooLow = actual < exp.min;
                    
                    const div = document.createElement('div');
                    div.className = 'flex justify-between items-center p-2 rounded ' + 
                        (isGood ? 'bg-green-50' : isTooLow ? 'bg-red-50' : 'bg-yellow-50');
                    
                    div.innerHTML = \`
                        <span class="font-medium">\${name.charAt(0).toUpperCase() + name.slice(1)}</span>
                        <span>
                            Expected: \${exp.min}-\${exp.max} | 
                            Actual: <strong>\${actual}</strong>
                            \${isGood ? '✅' : isTooLow ? '⚠️ Too low!' : '⚠️ Too high!'}
                        </span>
                    \`;
                    comparison.appendChild(div);
                });

                // Generate recommendations
                const recommendations = document.getElementById('recommendations');
                recommendations.innerHTML = '';
                
                const recs = [];
                
                // Check for failures
                const failures = Object.entries(data.results).filter(([_, r]) => r.status === 'error');
                if (failures.length > 0) {
                    failures.forEach(([name, result]) => {
                        if (result.error.includes('timeout') || result.error.includes('timed out')) {
                            recs.push(\`<strong>\${name}:</strong> Timing out. Consider upgrading to Vercel Pro for 60s timeout limit.\`);
                        } else {
                            recs.push(\`<strong>\${name}:</strong> Error - \${result.error}. Check Vercel logs for details.\`);
                        }
                    });
                }
                
                // Check for low counts
                Object.entries(data.results).forEach(([name, result]) => {
                    const exp = expected[name];
                    if (exp && result.count < exp.min) {
                        recs.push(\`<strong>\${name}:</strong> Low count (\${result.count} vs expected \${exp.min}-\${exp.max}). Filters may be too strict.\`);
                    }
                });
                
                if (data.summary.totalYields < 150) {
                    recs.push('<strong>Overall:</strong> Total yields below 150. Check failed sources and consider upgrading Vercel plan.');
                }
                
                if (recs.length === 0) {
                    recs.push('✅ Everything looks good! All sources are working as expected.');
                }
                
                recs.forEach(rec => {
                    const p = document.createElement('p');
                    p.innerHTML = '• ' + rec;
                    recommendations.appendChild(p);
                });
                
                results.classList.remove('hidden');
            } catch (err) {
                document.getElementById('errorMsg').textContent = err.message;
                error.classList.remove('hidden');
            } finally {
                loading.classList.add('hidden');
            }
        });

        // Toggle JSON output
        document.getElementById('toggleJson').addEventListener('click', () => {
            const output = document.getElementById('jsonOutput');
            const btn = document.getElementById('toggleJson');
            if (output.classList.contains('hidden')) {
                output.classList.remove('hidden');
                btn.textContent = 'Hide Raw JSON';
            } else {
                output.classList.add('hidden');
                btn.textContent = 'Show Raw JSON';
            }
        });

        // Auto-run on load
        window.addEventListener('load', () => {
            document.getElementById('testBtn').click();
        });
    </script>
</body>
</html>
  `;
  
  res.status(200).send(html);
}
