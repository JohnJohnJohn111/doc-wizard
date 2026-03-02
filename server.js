const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { generateDocument } = require('./documentGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ---------- helpers for /api/control-name ----------

function stripSuffix(name) {
  return name.replace(/\b(AB|HB|KB|EF|HANDELSBOLAG|AKTIEBOLAG|KOMMANDITBOLAG|ENSKILD\s+FIRMA)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function levenshteinSimilarity(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  if (a === b) return 1;
  const la = a.length, lb = b.length;
  if (la === 0 || lb === 0) return 0;
  const dp = Array.from({ length: la + 1 }, (_, i) => [i, ...Array(lb).fill(0)]);
  for (let j = 0; j <= lb; j++) dp[0][j] = j;
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  return 1 - dp[la][lb] / Math.max(la, lb);
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const opts = {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
        'Accept': 'text/html,application/xhtml+xml'
      }
    };
    https.get(url, opts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(body));
    }).on('error', reject).setTimeout(12000, function() { this.destroy(); reject(new Error('Timeout')); });
  });
}

// ---------- routes ----------

// Serve the form flow config
app.get('/api/flow', (req, res) => {
  const flow = require('./formFlow.json');
  res.json(flow);
});

// Name control — searches allabolag.se
app.post('/api/control-name', async (req, res) => {
  const { company_name } = req.body;
  if (!company_name || !company_name.trim())
    return res.status(400).json({ error: 'No company name provided' });

  try {
    const searchTerm = stripSuffix(company_name.trim());
    const encoded = encodeURIComponent(searchTerm);
    const searchUrl = `https://www.allabolag.se/what/${encoded}`;

    const html = await fetchHtml(searchUrl);

    // Extract company names from allabolag.se result links
    const namePattern = /href="\/[0-9]{6}-[0-9]{4}[^"]*"[^>]*>([^<]{3,80})</g;
    const altPattern = /class="[^"]*(?:company|organization|result)[^"]*"[^>]*>([A-ZÅÄÖ][^<]{2,60})</g;
    const found = new Map();

    let m;
    while ((m = namePattern.exec(html)) !== null) {
      const name = m[1].trim();
      if (name && !found.has(name.toLowerCase())) found.set(name.toLowerCase(), name);
    }
    while ((m = altPattern.exec(html)) !== null) {
      const name = m[1].trim();
      if (name && !found.has(name.toLowerCase())) found.set(name.toLowerCase(), name);
    }

    const proposedClean = stripSuffix(company_name.trim());
    const results = [...found.values()].slice(0, 25).map(name => {
      const score = levenshteinSimilarity(proposedClean, stripSuffix(name));
      const risk = score >= 0.80 ? 'high' : score >= 0.55 ? 'medium' : 'low';
      return { name, similarity: Math.round(score * 100), risk, url: searchUrl };
    }).sort((a, b) => b.similarity - a.similarity).slice(0, 10);

    const highRisk = results.filter(r => r.risk === 'high');
    const medRisk  = results.filter(r => r.risk === 'medium');
    let overall, overallLevel;
    if (highRisk.length > 0) {
      overall = `High risk — ${highRisk.length} closely matching name(s) found. Bolagsverket will likely reject this name.`;
      overallLevel = 'high';
    } else if (medRisk.length > 0) {
      overall = `Medium risk — ${medRisk.length} potentially similar name(s) found. Manual review recommended.`;
      overallLevel = 'medium';
    } else {
      overall = 'Low risk — No closely similar names found. This name appears available.';
      overallLevel = 'low';
    }

    res.json({ proposed_name: company_name, overall, overallLevel, results, searchUrl });
  } catch (err) {
    console.error('Control name error:', err.message);
    res.status(500).json({ error: 'Failed to reach allabolag.se. Please try again.' });
  }
});

// Generate document from answers
app.post('/api/generate', async (req, res) => {
  try {
    const { answers, templateId } = req.body;

    if (!answers || !templateId) {
      return res.status(400).json({ error: 'Missing answers or templateId' });
    }

    const outputPath = await generateDocument(templateId, answers);
    const filename = path.basename(outputPath);

    res.json({ 
      success: true, 
      downloadUrl: `/download/${filename}`,
      filename 
    });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Download endpoint
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'generated', req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Doc Wizard running at http://localhost:${PORT}\n`);
});
