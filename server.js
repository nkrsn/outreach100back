// server.js - Railway Backend for Church Data with JSON Storage
const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// Data file path
const DATA_FILE = path.join(__dirname, 'church-data.json');

// In-memory cache for performance
let cachedData = null;
let lastLoaded = null;

// Root route
app.get('/', (req, res) => {
  res.json({ 
    status: 'Church Data Backend is running!',
    dataSource: 'JSON file storage',
    endpoints: [
      '/health',
      '/api/get-data',
      '/api/scrape-and-save', 
      '/api/get-json-data',
      '/api/data-info'
    ]
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    dataFile: 'church-data.json'
  });
});

// Get church data from JSON file
app.get('/api/get-data', async (req, res) => {
  try {
    const data = await loadChurchData();
    
    if (!data || !data.consolidatedData) {
      return res.status(404).json({ 
        error: 'No church data found. Run /api/scrape-and-save first.' 
      });
    }

    res.json({
      consolidatedData: data.consolidatedData,
      lastUpdated: data.lastUpdated,
      totalChurches: data.consolidatedData.length,
      yearsCovered: data.yearsCovered || []
    });

  } catch (error) {
    console.error('Error loading church data:', error);
    res.status(500).json({ error: 'Failed to load church data' });
  }
});

// Get data file information
app.get('/api/data-info', async (req, res) => {
  try {
    const data = await loadChurchData();
    
    if (!data) {
      return res.json({
        exists: false,
        message: 'No data file found. Run scrape-and-save to create it.'
      });
    }

    res.json({
      exists: true,
      lastUpdated: data.lastUpdated,
      totalChurches: data.consolidatedData?.length || 0,
      yearsCovered: data.yearsCovered || [],
      fileSize: data.fileSize || 'unknown'
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to check data file' });
  }
});

// Get formatted JSON data with mobile-friendly interface
app.get('/api/get-json-data', async (req, res) => {
  try {
    const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
    const allData = {};
    const errors = [];

    // Check if request wants raw JSON
    if (req.query.format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      
      for (const year of years) {
        try {
          const churches = await scrapeYearData(year);
          allData[year] = churches;
        } catch (error) {
          console.error(`Failed to scrape ${year}:`, error);
          errors.push({ year, error: error.message });
        }
      }

      const consolidatedData = consolidateChurchData(allData);
      const dataToSave = {
        consolidatedData,
        yearlyData: allData,
        errors,
        lastUpdated: new Date().toISOString(),
        yearsCovered: years.filter(year => allData[year] && allData[year].length > 0),
        totalChurches: consolidatedData.length
      };

      return res.json(dataToSave);
    }

    // Mobile-friendly HTML interface
    res.setHeader('Content-Type', 'text/html');
    
    for (const year of years) {
      try {
        const churches = await scrapeYearData(year);
        allData[year] = churches;
      } catch (error) {
        console.error(`Failed to scrape ${year}:`, error);
        errors.push({ year, error: error.message });
      }
    }

    const consolidatedData = consolidateChurchData(allData);
    const dataToSave = {
      consolidatedData,
      yearlyData: allData,
      errors,
      lastUpdated: new Date().toISOString(),
      yearsCovered: years.filter(year => allData[year] && allData[year].length > 0),
      totalChurches: consolidatedData.length
    };

    const jsonString = JSON.stringify(dataToSave, null, 2);

    res.send(`
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Church Data JSON</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 20px; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { background: #f0f8ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        .json-container { background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
        textarea { width: 100%; height: 400px; font-family: monospace; font-size: 12px; }
        .button { background: #007AFF; color: white; padding: 12px 20px; border: none; border-radius: 8px; font-size: 16px; margin: 5px; }
        .instructions { background: #fff3cd; padding: 15px; border-radius: 8px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Church Data JSON</h1>
            <p>Total churches: ${dataToSave.totalChurches}</p>
            <p>Last updated: ${new Date(dataToSave.lastUpdated).toLocaleString()}</p>
        </div>

        <div class="json-container">
            <h3>📋 JSON Data (Select All → Copy):</h3>
            <textarea id="jsonData" readonly>${jsonString}</textarea>
            <br>
            <button class="button" onclick="selectAndCopy()">📱 Select All & Copy</button>
            <button class="button" onclick="downloadJSON()">💾 Download JSON</button>
        </div>

        <div class="instructions">
            <h3>📱 iOS Safari Instructions:</h3>
            <ol>
                <li><strong>Tap "Select All & Copy"</strong> to copy the JSON</li>
                <li><strong>Open WorkingCopy app</strong></li>
                <li><strong>Navigate to your backend repo</strong></li>
                <li><strong>Create new file:</strong> church-data.json</li>
                <li><strong>Paste the JSON content</strong></li>
                <li><strong>Commit and push to GitHub</strong></li>
            </ol>
        </div>
    </div>

    <script>
        function selectAndCopy() {
            const textarea = document.getElementById('jsonData');
            textarea.select();
            textarea.setSelectionRange(0, 99999);
            
            try {
                document.execCommand('copy');
                alert('✅ JSON copied to clipboard!');
            } catch (err) {
                alert('❌ Copy failed. Please select all text manually.');
            }
        }

        function downloadJSON() {
            const jsonData = document.getElementById('jsonData').value;
            const blob = new Blob([jsonData], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'church-data.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    </script>
</body>
</html>
    `);

  } catch (error) {
    console.error('Error generating JSON data:', error);
    res.status(500).json({ error: error.message });
  }
});

// One-time scraping with progress updates (for manual saving)
app.get('/api/scrape-and-save', async (req, res) => {
  try {
    const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
    const allData = {};
    const errors = [];

    // Set headers for streaming text response
    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked'
    });

    res.write('🚀 Starting church data scraping...\n\n');

    for (const year of years) {
      try {
        res.write(`📅 Scraping ${year}...\n`);
        const churches = await scrapeYearData(year);
        allData[year] = churches;
        res.write(`✅ Successfully scraped ${churches.length} churches from ${year}\n`);
      } catch (error) {
        console.error(`Failed to scrape ${year}:`, error);
        errors.push({ year, error: error.message });
        res.write(`❌ Failed to scrape ${year}: ${error.message}\n`);
      }
    }

    // Consolidate data by church
    res.write('\n🔄 Consolidating data...\n');
    const consolidatedData = consolidateChurchData(allData);

    // Create the data structure
    const dataToSave = {
      consolidatedData,
      yearlyData: allData,
      errors,
      lastUpdated: new Date().toISOString(),
      yearsCovered: years.filter(year => allData[year] && allData[year].length > 0),
      totalChurches: consolidatedData.length
    };

    res.write(`\n📊 Consolidation complete!\n`);
    res.write(`📈 Total churches with multi-year data: ${consolidatedData.length}\n`);
    res.write(`📅 Years covered: ${dataToSave.yearsCovered.join(', ')}\n`);
    
    if (errors.length > 0) {
      res.write(`⚠️ Errors: ${errors.length} years failed\n`);
    }

    res.write('\n' + '='.repeat(80) + '\n');
    res.write('📄 FOR CLEAN JSON DATA, VISIT:\n');
    res.write(`${req.protocol}://${req.get('host')}/api/get-json-data\n`);
    res.write('='.repeat(80) + '\n');
    res.write('📋 Safari Instructions:\n');
    res.write('1. Visit the /api/get-json-data URL above\n');
    res.write('2. Use the mobile-friendly interface\n');
    res.write('3. Copy JSON and add to your repo\n');
    res.write('4. Commit and push to GitHub\n');
    res.write('='.repeat(80) + '\n');

    res.end();

  } catch (error) {
    console.error('Error in scrape-and-save:', error);
    res.write(`\n❌ Fatal error: ${error.message}\n`);
    res.end();
  }
});

// Load church data from JSON file
async function loadChurchData() {
  try {
    // Use in-memory cache for performance
    if (cachedData && lastLoaded && (Date.now() - lastLoaded) < 60000) { // 1 minute cache
      return cachedData;
    }

    const fileExists = await fs.access(DATA_FILE).then(() => true).catch(() => false);
    if (!fileExists) {
      return null;
    }

    const fileContent = await fs.readFile(DATA_FILE, 'utf8');
    const data = JSON.parse(fileContent);
    
    // Cache in memory
    cachedData = data;
    lastLoaded = Date.now();
    
    return data;
  } catch (error) {
    console.error('Error loading church data:', error);
    return null;
  }
}

// Scraping functions (used only for initial data collection)
async function scrapeYearData(year) {
  const churches = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages && page <= 10) { // Limit to 10 pages to avoid infinite loops
    try {
      const url = page === 1 
        ? `https://outreach100.com/largest-churches-in-america/${year}`
        : `https://outreach100.com/largest-churches-in-america/${year}?page=${page}`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        if (page === 1) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        } else {
          break; // End of pages
        }
      }

      const html = await response.text();
      const pageChurches = parseChurchesFromHTML(html, year);

      if (pageChurches.length === 0) {
        hasMorePages = false;
      } else {
        churches.push(...pageChurches);
        page++;
      }

      // Be respectful - small delay between requests
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error) {
      if (page === 1) {
        throw error;
      } else {
        console.warn(`Failed to fetch page ${page} for ${year}:`, error);
        break;
      }
    }
  }

  return churches;
}

function parseChurchesFromHTML(html, year) {
  const $ = cheerio.load(html);
  const churches = [];

  // Look for church entries - they appear in specific patterns
  $('a[href*="/churches/"]').each((index, element) => {
    try {
      const $link = $(element);
      const $container = $link.closest('div, section, article');

      // Extract ranking
      let ranking = null;
      
      // Try to find ranking number in various ways
      const rankingSelectors = [
        $container.prev().text().trim(),
        $container.find('*').first().text().trim(),
        $link.prev().text().trim()
      ];

      for (const text of rankingSelectors) {
        const rankMatch = text.match(/^\d+$/);
        if (rankMatch && parseInt(rankMatch[0]) <= 100) {
          ranking = parseInt(rankMatch[0]);
          break;
        }
      }

      // Fallback: use incremental ranking
      if (!ranking) {
        ranking = index + 1;
      }

      // Extract church name
      let churchName = $link.text().trim();
      if (!churchName) {
        churchName = $container.find('h1, h2, h3, h4, h5, h6').first().text().trim();
      }

      // Extract location and pastor
      let location = '';
      let pastor = '';

      $container.find('*').each((i, elem) => {
        const text = $(elem).text().trim();
        
        // Location pattern: "City, State"
        if (/^[A-Za-z\s]+,\s*[A-Z]{2,}$/.test(text) && text.length < 50) {
          location = text;
        }
        
        // Pastor pattern: often follows a dash
        if (text.includes('-') && text.length < 100) {
          const parts = text.split('-');
          if (parts.length >= 2) {
            const possiblePastor = parts[parts.length - 1].trim();
            if (possiblePastor && !possiblePastor.includes(',') && possiblePastor.length < 50) {
              pastor = possiblePastor;
            }
          }
        }
      });

      // Extract attendance if available
      let attendance = null;
      $container.find('*').each((i, elem) => {
        const text = $(elem).text().trim();
        const numberMatch = text.match(/\b(\d{3,6})\b/);
        if (numberMatch && !attendance) {
          const number = parseInt(numberMatch[1]);
          if (number >= 1000 && number <= 100000) {
            attendance = number;
          }
        }
      });

      if (churchName && ranking) {
        churches.push({
          name: churchName,
          location: location || 'Location not found',
          pastor: pastor || 'Pastor not found',
          attendance: attendance,
          ranking: ranking
        });
      }

    } catch (error) {
      console.warn('Error parsing church:', error);
    }
  });

  return churches.sort((a, b) => a.ranking - b.ranking);
}

function consolidateChurchData(yearlyData) {
  const churchMap = new Map();

  Object.entries(yearlyData).forEach(([year, churches]) => {
    churches.forEach(church => {
      if (!churchMap.has(church.name)) {
        churchMap.set(church.name, {
          name: church.name,
          location: church.location,
          pastor: church.pastor,
          data: []
        });
      }

      churchMap.get(church.name).data.push({
        year: parseInt(year),
        attendance: church.attendance,
        ranking: church.ranking
      });
    });
  });

  return Array.from(churchMap.values())
    .filter(church => church.data.length >= 3)
    .map(church => ({
      ...church,
      data: church.data.sort((a, b) => a.year - b.year)
    }))
    .sort((a, b) => {
      const aLatest = a.data[a.data.length - 1];
      const bLatest = b.data[b.data.length - 1];
      return aLatest.ranking - bLatest.ranking;
    });
}

app.listen(PORT, () => {
  console.log(`Church data backend running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  GET / - Status and endpoint list`);
  console.log(`  GET /health - Health check`);
  console.log(`  GET /api/get-data - Get church data from JSON file`);
  console.log(`  GET /api/get-json-data - Mobile-friendly JSON interface`);
  console.log(`  GET /api/scrape-and-save - One-time scraping`);
  console.log(`  GET /api/data-info - Data file information`);
});

module.exports = app;