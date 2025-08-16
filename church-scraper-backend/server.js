// server.js - Railway Backend for Church Data Scraping
const express = require(‘express’);
const cors = require(‘cors’);
const cheerio = require(‘cheerio’);
const fetch = require(‘node-fetch’);

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for all routes
app.use(cors());
app.use(express.json());

// In-memory cache to avoid re-scraping
const dataCache = new Map();
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

// Health check endpoint
app.get(’/health’, (req, res) => {
res.json({ status: ‘healthy’, timestamp: new Date().toISOString() });
});

// Scrape specific year
app.get(’/api/scrape-year/:year’, async (req, res) => {
const year = parseInt(req.params.year);

if (year < 2015 || year > 2024) {
return res.status(400).json({ error: ‘Year must be between 2015 and 2024’ });
}

try {
const cacheKey = `year-${year}`;
const cached = dataCache.get(cacheKey);

```
if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
  return res.json({ 
    data: cached.data, 
    cached: true, 
    scrapedAt: cached.timestamp 
  });
}

const churches = await scrapeYearData(year);

// Cache the results
dataCache.set(cacheKey, {
  data: churches,
  timestamp: Date.now()
});

res.json({ 
  data: churches, 
  cached: false,
  scrapedAt: Date.now()
});
```

} catch (error) {
console.error(`Error scraping year ${year}:`, error);
res.status(500).json({
error: `Failed to scrape ${year} data: ${error.message}`
});
}
});

// Scrape all years
app.get(’/api/scrape-all’, async (req, res) => {
try {
const years = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const allData = {};
const errors = [];

```
for (const year of years) {
  try {
    const churches = await scrapeYearData(year);
    allData[year] = churches;
    console.log(`Successfully scraped ${churches.length} churches from ${year}`);
  } catch (error) {
    console.error(`Failed to scrape ${year}:`, error);
    errors.push({ year, error: error.message });
  }
}

// Consolidate data by church
const consolidatedData = consolidateChurchData(allData);

res.json({
  consolidatedData,
  yearlyData: allData,
  errors,
  scrapedAt: Date.now()
});
```

} catch (error) {
console.error(‘Error in scrape-all:’, error);
res.status(500).json({ error: error.message });
}
});

// Get cached data only
app.get(’/api/cached-data’, (req, res) => {
const allCached = {};

for (let [key, value] of dataCache.entries()) {
if (key.startsWith(‘year-’)) {
const year = key.replace(‘year-’, ‘’);
allCached[year] = {
data: value.data,
timestamp: value.timestamp,
age: Date.now() - value.timestamp
};
}
}

res.json({ cachedData: allCached });
});

async function scrapeYearData(year) {
const churches = [];
let page = 1;
let hasMorePages = true;

while (hasMorePages && page <= 10) {
try {
const url = page === 1
? `https://outreach100.com/largest-churches-in-america/${year}`
: `https://outreach100.com/largest-churches-in-america/${year}?page=${page}`;

```
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
```

}

return churches;
}

function parseChurchesFromHTML(html, year) {
const $ = cheerio.load(html);
const churches = [];

// Look for church entries - they appear in specific patterns
$(‘a[href*="/churches/"]’).each((index, element) => {
try {
const $link = $(element);
const $container = $link.closest(‘div, section, article’);

```
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
```

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

```
  churchMap.get(church.name).data.push({
    year: parseInt(year),
    attendance: church.attendance,
    ranking: church.ranking
  });
});
```

});

return Array.from(churchMap.values())
.filter(church => church.data.length >= 3)
.map(church => ({
…church,
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