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

// Generic HTTPS GET → returns parsed JSON
function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'CMSW-ShelfCompanyGenerator/1.0',
        'Accept': 'application/json'
      }
    }, (res) => {
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
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timed out')); });
  });
}

function stripSuffix(name) {
  return name
    .replace(/\b(AB|HB|KB|EF|HANDELSBOLAG|AKTIEBOLAG|KOMMANDITBOLAG|ENSKILD\s+FIRMA|publ)\b/gi, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────────────────────
//  Route: Name Control (Claude AI + web search)
// ─────────────────────────────────────────────

app.post('/api/control-name', async (req, res) => {
  const { company_name } = req.body;
  if (!company_name || !company_name.trim())
    return res.status(400).json({ error: 'No company name provided' });

  const proposed     = company_name.trim();
  const cleanName    = stripSuffix(proposed);
  const encoded      = encodeURIComponent(cleanName);
  const searchUrl    = `https://www.allabolag.se/what/${encoded}`;

  try {
    // Call Claude API with web_search tool to research Swedish company name conflicts
    const prompt = `You are a Swedish corporate law assistant helping check if a proposed company name can be registered at Bolagsverket (the Swedish Companies Registration Office).

The proposed company name is: "${proposed}"

Please search allabolag.se and other Swedish company sources to find:
1. Any EXISTING Swedish registered companies with this EXACT name or nearly identical names
2. Any companies whose name CONTAINS the same distinctive/key word(s) as the proposed name
3. Any well-known brands, trademarks, or protected names that the proposed name could conflict with

Focus especially on finding identical or near-identical matches first, then similar ones.

Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation outside the JSON):
{
  "overallLevel": "high" | "medium" | "low",
  "overall": "one sentence summary of the risk",
  "results": [
    {
      "name": "exact company name found",
      "risk": "high" | "medium" | "low",
      "similarity": <number 0-100>,
      "matchReason": "brief reason why this is a conflict",
      "url": "https://www.allabolag.se/what/..."
    }
  ]
}

Risk levels:
- "high": exact or near-identical match exists — Bolagsverket will reject the name
- "medium": similar name or same key distinctive word in the same industry
- "low": loosely similar but probably not a conflict

Return at most 10 results, sorted by similarity descending. If no conflicts found, return empty results array and overallLevel "low".`;

    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2000,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const apiData = await apiRes.json();

    if (!apiRes.ok) {
      throw new Error(apiData.error?.message || 'Claude API error');
    }

    // Extract the final text response (last text block)
    const textBlocks = (apiData.content || []).filter(b => b.type === 'text');
    const rawText = textBlocks.map(b => b.text).join('').trim();

    // Parse JSON — strip any accidental markdown fences
    const jsonText = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e) {
      // If parsing fails, return a graceful fallback
      console.error('JSON parse error. Raw text:', rawText.substring(0, 500));
      return res.json({
        proposed_name: proposed,
        overall: 'Search completed but results could not be parsed. Please verify manually using the link below.',
        overallLevel: 'unknown',
        results: [],
        searchUrl
      });
    }

    return res.json({
      proposed_name: proposed,
      overall: parsed.overall || 'Search complete.',
      overallLevel: parsed.overallLevel || 'low',
      results: (parsed.results || []).map(r => ({
        name: r.name,
        risk: r.risk || 'low',
        similarity: r.similarity || 0,
        matchReason: r.matchReason || '',
        url: r.url || searchUrl
      })),
      searchUrl
    });

  } catch (err) {
    console.error('Name control error:', err.message);
    return res.json({
      proposed_name: proposed,
      overall: 'Automated search is temporarily unavailable. Please use the manual search link below.',
      overallLevel: 'unknown',
      results: [],
      searchUrl
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
