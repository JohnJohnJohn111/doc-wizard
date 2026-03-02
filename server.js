const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { generateDocument } = require('./documentGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────

function stripSuffix(name) {
  return name
    .replace(/\b(AB|HB|KB|EF|HANDELSBOLAG|AKTIEBOLAG|KOMMANDITBOLAG|ENSKILD\s+FIRMA)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinSimilarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

// Generic HTTPS GET → returns parsed JSON
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'CMSW-ShelfCompanyGenerator/1.0',
        'Accept': 'application/json'
      }
    }, (res) => {
      // follow one redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return getJson(res.headers.location).then(resolve).catch(reject);
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('Invalid JSON from API')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

// Score a list of raw company name strings against the proposed name
function scoreNames(names, proposedClean) {
  const seen = new Set();
  return names
    .filter(name => {
      if (!name || name.length < 2) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(name => {
      const score = levenshteinSimilarity(proposedClean, stripSuffix(name));
      const risk = score >= 0.80 ? 'high' : score >= 0.55 ? 'medium' : 'low';
      return { name, similarity: Math.round(score * 100), risk };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 10);
}

function buildOverall(results) {
  const high = results.filter(r => r.risk === 'high');
  const med  = results.filter(r => r.risk === 'medium');
  if (high.length > 0) return {
    overall: `High risk — ${high.length} closely matching name(s) found. Bolagsverket will likely reject this name.`,
    overallLevel: 'high'
  };
  if (med.length > 0) return {
    overall: `Medium risk — ${med.length} potentially similar name(s) found. Manual review recommended before registering.`,
    overallLevel: 'medium'
  };
  return {
    overall: 'Low risk — No closely similar names found. This name appears available.',
    overallLevel: 'low'
  };
}

// ─────────────────────────────────────────────
//  Route: Name Control
// ─────────────────────────────────────────────

app.post('/api/control-name', async (req, res) => {
  const { company_name } = req.body;
  if (!company_name || !company_name.trim())
    return res.status(400).json({ error: 'No company name provided' });

  const proposed      = company_name.trim();
  const proposedClean = stripSuffix(proposed);
  const encoded       = encodeURIComponent(proposedClean);

  // OpenCorporates public API — Swedish companies (jurisdiction: se)
  // Optional: add &api_token=YOUR_TOKEN for higher rate limits
  const apiToken = process.env.OPENCORPORATES_API_TOKEN
    ? `&api_token=${process.env.OPENCORPORATES_API_TOKEN}`
    : '';
  const ocUrl = `https://api.opencorporates.com/v0.4/companies/search?q=${encoded}&jurisdiction_code=se&per_page=30${apiToken}`;

  try {
    const data = await getJson(ocUrl);
    const companies = (data?.results?.companies || []).map(c => c.company?.name).filter(Boolean);

    if (companies.length === 0) {
      return res.json({
        proposed_name: proposed,
        overall: 'No results found in the company register. Please also verify manually via the link below.',
        overallLevel: 'unknown',
        results: [],
        searchUrl: `https://www.allabolag.se/what/${encoded}`
      });
    }

    const results = scoreNames(companies, proposedClean);
    const { overall, overallLevel } = buildOverall(results);

    return res.json({
      proposed_name: proposed,
      overall,
      overallLevel,
      results: results.map(r => ({
        ...r,
        url: `https://www.allabolag.se/what/${encodeURIComponent(stripSuffix(r.name))}`
      })),
      searchUrl: `https://www.allabolag.se/what/${encoded}`
    });

  } catch (err) {
    console.error('Name control error:', err.message);
    // Graceful fallback — give user the manual check link rather than a hard error
    return res.json({
      proposed_name: proposed,
      overall: 'Automated search is temporarily unavailable. Please use the manual search link below to check the name on allabolag.se.',
      overallLevel: 'unknown',
      results: [],
      searchUrl: `https://www.allabolag.se/what/${encoded}`
    });
  }
});

// ─────────────────────────────────────────────
//  Existing routes (unchanged)
// ─────────────────────────────────────────────

app.get('/api/flow', (req, res) => {
  const flow = require('./formFlow.json');
  res.json(flow);
});

app.post('/api/generate', async (req, res) => {
  try {
    const { answers, templateId } = req.body;
    if (!answers || !templateId)
      return res.status(400).json({ error: 'Missing answers or templateId' });

    const outputPath = await generateDocument(templateId, answers);
    const filename = path.basename(outputPath);

    res.json({ success: true, downloadUrl: `/download/${filename}`, filename });
  } catch (err) {
    console.error('Generation error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/download/:filename', (req, res) => {
  const filePath = path.join(__dirname, 'generated', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
  res.download(filePath);
});

app.listen(PORT, () => {
  console.log(`\n🚀 Doc Wizard running at http://localhost:${PORT}\n`);
});
