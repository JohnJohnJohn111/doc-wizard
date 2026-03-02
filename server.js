const express = require('express');
const path = require('path');
const fs = require('fs');
const { generateDocument } = require('./documentGenerator');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static('public'));

// Serve the form flow config
app.get('/api/flow', (req, res) => {
  const flow = require('./formFlow.json');
  res.json(flow);
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
