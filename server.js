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

// Words that carry no distinctiveness for name protection purposes
const GENERIC_WORDS = new Set([
  'och','and','i','of','the','för','ab','hb','kb','ef','group','grupp',
  'holding','invest','finans','finance','konsult','consulting','service',
  'services','solutions','lösningar','sverige','sweden','nordic','norden',
  'skandinavien','scandinavia','management','kapital','capital','partner',
  'partners','utveckling','development','bolag','company','företag','handel',
  'trading','fastighet','property','real','estate','bygg','construction',
  'teknik','technology','tech','media','kommunikation','communication'
]);

function stripSuffix(name) {
  return name
    .replace(/\b(AB|HB|KB|EF|HANDELSBOLAG|AKTIEBOLAG|KOMMANDITBOLAG|ENSKILD\s+FIRMA)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Tokenise a name into meaningful words (strips suffix, lowercases, removes generics)
function keyTokens(name) {
  return stripSuffix(name)
    .toLowerCase()
    .replace(/[^a-zåäö0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !GENERIC_WORDS.has(w));
}

// Levenshtein edit distance
function levenshtein(a, b) {
  if (a === b) return 0;
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  const dp = Array.from({ length: la + 1 }, (_, i) =>
    Array.from({ length: lb + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= la; i++)
    for (let j = 1; j <= lb; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j-1], dp[i-1][j], dp[i][j-1]);
  return dp[la][lb];
}

// Whole-string edit-distance similarity (0–1)
function editSimilarity(a, b) {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (!a.length && !b.length) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

// Fuzzy word match: two tokens are "the same" if edit distance ≤ 1 per 4 chars
function fuzzyWordMatch(w1, w2) {
  if (w1 === w2) return true;
  if (Math.abs(w1.length - w2.length) > 2) return false;
  const maxDist = Math.floor(Math.max(w1.length, w2.length) / 4);
  return levenshtein(w1, w2) <= maxDist;
}

// Keyword overlap score (0–1): proportion of proposed key-tokens found in candidate
function keywordOverlap(proposedTokens, candidateTokens) {
  if (proposedTokens.length === 0) return 0;
  let matched = 0;
  for (const pt of proposedTokens) {
    if (candidateTokens.some(ct => fuzzyWordMatch(pt, ct))) matched++;
  }
  return matched / proposedTokens.length;
}

// Does the candidate START with one of the proposed tokens (prefix brand risk)?
function prefixMatch(proposedTokens, candidateClean) {
  const cl = candidateClean.toLowerCase();
  return proposedTokens.some(t => t.length >= 4 && cl.startsWith(t));
}

// Composite score combining three signals
function compositeScore(proposed, proposedClean, proposedTokens, candidate) {
  const candidateClean  = stripSuffix(candidate);
  const candidateTokens = keyTokens(candidate);

  const s1 = editSimilarity(proposedClean, candidateClean);          // whole-string edit distance
  const s2 = keywordOverlap(proposedTokens, candidateTokens);        // keyword token overlap
  const s3 = prefixMatch(proposedTokens, candidateClean) ? 0.9 : 0; // prefix brand risk boost

  // Weighted combination — keyword overlap is most important for Bolagsverket-style assessment
  const weighted = (s1 * 0.30) + (s2 * 0.55) + (s3 * 0.15);
  return Math.min(1, weighted);
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

// Fetch companies from OpenCorporates for a given search term
async function fetchCompanies(searchTerm, apiToken) {
  const encoded = encodeURIComponent(searchTerm);
  const token   = apiToken ? `&api_token=${apiToken}` : '';
  const url     = `https://api.opencorporates.com/v0.4/companies/search?q=${encoded}&jurisdiction_code=se&per_page=30${token}`;
  const data    = await getJson(url);
  return (data?.results?.companies || []).map(c => c.company?.name).filter(Boolean);
}

// Score and deduplicate a list of candidate names
function scoreNames(proposed, proposedClean, proposedTokens, names) {
  const seen = new Map(); // name.toLowerCase() → best score entry
  for (const name of names) {
    if (!name || name.length < 2) continue;
    const key   = name.toLowerCase();
    const score = compositeScore(proposed, proposedClean, proposedTokens, name);
    if (!seen.has(key) || score > seen.get(key).score) {
      seen.set(key, { name, score });
    }
  }
  return [...seen.values()]
    .filter(e => e.score >= 0.30) // drop completely unrelated names
    .map(e => {
      const risk = e.score >= 0.75 ? 'high' : e.score >= 0.45 ? 'medium' : 'low';
      return {
        name: e.name,
        similarity: Math.round(e.score * 100),
        risk,
        matchReason: buildMatchReason(proposedTokens, e.name)
      };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 12);
}

// Human-readable explanation of why a match was flagged
function buildMatchReason(proposedTokens, candidate) {
  const ct = keyTokens(candidate);
  const shared = proposedTokens.filter(pt => ct.some(c => fuzzyWordMatch(pt, c)));
  if (shared.length > 0)
    return `Shares keyword${shared.length > 1 ? 's' : ''}: ${shared.map(w => '"' + w + '"').join(', ')}`;
  return 'Similar name structure';
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

  const proposed       = company_name.trim();
  const proposedClean  = stripSuffix(proposed);
  const proposedTokens = keyTokens(proposed);
  const apiToken       = process.env.OPENCORPORATES_API_TOKEN || '';
  const encoded        = encodeURIComponent(proposedClean);
  const searchUrl      = `https://www.allabolag.se/what/${encoded}`;

  try {
    // Build a list of search queries:
    //   1. The full cleaned name  (e.g. "Volvo Göteborg")
    //   2. Each meaningful keyword individually  (e.g. "Volvo", "Göteborg")
    // This ensures we catch "Volvo AB" even when searching "Volvo Göteborg AB"
    const searchTerms = [proposedClean];
    for (const token of proposedTokens) {
      if (token.length >= 4 && !searchTerms.includes(token)) searchTerms.push(token);
    }

    // Run all searches in parallel (cap at 4 to stay within rate limits)
    const allResults = await Promise.allSettled(
      searchTerms.slice(0, 4).map(term => fetchCompanies(term, apiToken))
    );

    const allNames = allResults
      .filter(r => r.status === 'fulfilled')
      .flatMap(r => r.value);

    if (allNames.length === 0) {
      return res.json({
        proposed_name: proposed,
        overall: 'No results found in the company register. Please also verify manually via the link below.',
        overallLevel: 'unknown',
        results: [],
        searchUrl
      });
    }

    const results = scoreNames(proposed, proposedClean, proposedTokens, allNames);
    const { overall, overallLevel } = buildOverall(results);

    return res.json({
      proposed_name: proposed,
      overall,
      overallLevel,
      results: results.map(r => ({
        ...r,
        url: `https://www.allabolag.se/what/${encodeURIComponent(stripSuffix(r.name))}`
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
