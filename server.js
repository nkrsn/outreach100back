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

// One-time scraping to populate JSON file (admin use)
app.get('/api/scrape-and-save', async (req, res) => {
  try {
    const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
    const allData = {};
    const errors = [];

    res.writeHead(200, {
      'Content-Type': 'text/plain',
      'Transfer-Encoding': 'chunked'
    });

    res.write('Starting church data scraping...\n\n');

    for (const year of years) {
      try {
        res.write(`Scraping ${year}...\n`);
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
    res.write('\nConsolidating data...\n');
    const consolidatedData = consolidateChurchData(allData);

    // Save to JSON file
    const dataToSave = {
      consolidatedData,
      yearlyData: allData,
      errors,
      lastUpdated: new Date().toISOString(),
      yearsCovered: years.filter(year => allData[year] && allData[year].length > 0)
    };

    await fs.writeFile(DATA_FILE, JSON.stringify(dataToSave, null, 2));
    
    // Clear cache to force reload
    cachedData = null;
    lastLoaded = null;

    res.write(`\n✅ Data saved to church-data.json\n`);
    res.write(`📊 Total churches with multi-year data: ${consolidatedData.length}\n`);
    res.write(`📅 Years covered: ${dataToSave.yearsCovered.join(', ')}\n`);
    
    if (errors.length > 0) {
      res.write(`⚠️ Errors: ${errors.length} years failed\n`);
    }

    res.write('\n🎉 Scraping complete! Data is now persisted.\n');
    res.end();

  } catch (error) {
    console.error('Error in scrape-and-save:', error);
    res.write(`\n❌ Fatal error: ${error.message}\n`);
    res.end();
  }
});

// Scraping functions (used only for initial data collection)
async function scrapeYearData(year) {
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
  const churches = [];
  let page = 1;
  let hasMorePages = true;

  while (hasMorePages && page <= 10) {
    try {
      const url = page === 1 
        ? `https://outreach100.com/largest-churches-in-america/${year}`
        : `https://outreach100.com/largest-churches-in-america/${year}?page=${page}`;

      console.log(`Fetching ${url}`);
      
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
  console.log(`Church scraping server running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  GET /health - Health check`);
  console.log(`  GET /api/scrape-year/:year - Scrape specific year`);
  console.log(`  GET /api/scrape-all - Scrape all years`);
  console.log(`  GET /api/cached-data - Get cached data`);
});

module.exports = app;