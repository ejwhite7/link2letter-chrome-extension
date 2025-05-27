// Add missing constant at the top with other constants
const API_BASE_URL = CONFIG.API_BASE_URL; // Replace with actual API URL

// Initialize saved links array
const savedLinks = [];
const allTags = new Set();

// On extension installation, load saved links from storage
chrome.runtime.onInstalled.addListener(() => {
  loadSavedLinks();
});

// Listen for messages from other parts of the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const actionHandlers = {
    getSavedLinks: () => sendResponse({ savedLinks }),
    saveLink: () => saveLink(request.link, sendResponse),
    deleteLink: () => deleteLink(request.linkId, sendResponse),
    getRSSFeed: () => sendResponse({ rssFeed: generateRSSFeed() }),
    loadRSSFeedURL: () => loadRSSFeedURL()
  };

  if (actionHandlers[request.action]) {
    actionHandlers[request.action]();
    return true; // Indicate async response
  }

  if (request.action === 'createLink') {
    createLink(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'updateLink') {
    updateLink(request.data)
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  if (request.action === 'getLinks') {
    getLinks()
      .then(response => sendResponse(response))
      .catch(error => sendResponse({ error: error.message }));
    return true;
  }

  sendResponse({ error: 'Unknown action' });
  return false;
});

// Load saved links from local storage
async function loadSavedLinks() {
  try {
    const result = await new Promise(resolve => {
      chrome.storage.local.get({ savedLinks: [] }, resolve);
    });
    if (result.savedLinks) {
      savedLinks.length = 0; // Clear existing array
      savedLinks.push(...result.savedLinks);
    }
  } catch (error) {
    console.error('Error loading saved links:', error);
  }
}

// Save a new link
function saveLink(link, callback) {
  savedLinks.push(link);
  for (const tag of link.tags) {
    allTags.add(tag);
  }
  updateStorage(callback);
}

// Delete a link
async function deleteLink(linkId, callback) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key found');

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.links}/${linkId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || 'Failed to delete link');
    }

    // Update local storage after successful deletion
    chrome.storage.local.get({ savedLinks: [] }, (result) => {
      const updatedLinks = result.savedLinks.filter(link => link.id !== linkId);
      chrome.storage.local.set({ savedLinks: updatedLinks }, () => {
        if (callback) callback({ success: true });
      });
    });
  } catch (error) {
    console.error('Error deleting link:', error);
    if (callback) callback({ success: false, message: error.message });
  }
}

// Update local storage with the current saved links
function updateStorage(callback) {
  chrome.storage.local.set({ savedLinks, allTags: Array.from(allTags) }, () => {
    if (callback) callback({ success: true, savedLinks, allTags: Array.from(allTags) });
  });
}

// Generate an RSS feed from saved links
function generateRSSFeed() {
  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
  <title>Saved Links for beehiiv</title>
  <description>Links saved from the web for beehiiv newsletters</description>
  <link>https://www.beehiiv.com</link>
  ${savedLinks.map(link => `
  <item>
    <title>${escapeXML(link.title)}</title>
    <link>${escapeXML(link.url)}</link>
    <description>${escapeXML(link.description)}</description>
    <pubDate>${new Date(link.date).toUTCString()}</pubDate>
    ${link.tags.map(tag => `<category>${escapeXML(tag)}</category>`).join('')}
  </item>
  `).join('')}
</channel>
</rss>`;
}

// Escape XML special characters
function escapeXML(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '\'': '&apos;',
    '"': '&quot;'
  }[c]));
}

// Load RSS Feed URL
function loadRSSFeedURL() {
    // Placeholder logic for loading the RSS feed URL
    console.log("Loading RSS Feed URL...");
    // Example: Fetch the RSS feed URL from storage or a server
    chrome.storage.local.get('rssFeedURL', (result) => {
        if (result.rssFeedURL) {
            console.log("RSS Feed URL:", result.rssFeedURL);
            // Further processing of the RSS feed URL
        } else {
            console.error("No RSS Feed URL found.");
        }
    });
}

function updateRSSFeed() {
  const rssFeed = generateRSSFeed();
  chrome.storage.local.set({ rssFeed }, () => {
    console.log('RSS feed updated successfully.');
  });
}

// Update API endpoints
const API_ENDPOINTS = {
  generateApiKey: '/api/generate-api-key',
  getFeedUrl: '/api/validate-api-key',
  getSubscription: '/api/subscription',
  links: '/api/links'
};

// Update link creation function
async function createLink(linkData) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key found');

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.links}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        url: linkData.url,
        title: linkData.title,
        description: linkData.description || null,
        notes: linkData.notes || null,
        tags: linkData.tags || []
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to create link');
    }

    return data;
  } catch (error) {
    console.error('Error creating link:', error);
    throw error;
  }
}

// Add function to check subscription status
async function checkSubscriptionStatus() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key found');

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.getSubscription}`, {
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({ error: 'Network response was not ok' }));
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    if (error instanceof TypeError) {
      console.error('Network error checking subscription:', error);
      throw new Error('Network error - please check your connection');
    }
    console.error('Error checking subscription:', error);
    throw error;
  }
}

// Update API key generation function
async function generateNewApiKey() {
  try {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.generateApiKey}`, {
      method: 'POST'
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to generate API key');
    }

    await storeApiKey(data.apiKey);
    return data.apiKey;
  } catch (error) {
    console.error('Error generating API key:', error);
    throw error;
  }
}

// Update API key generation function
async function updateLink(linkData) {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key found');

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.links}/${linkData.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({
        url: linkData.url,
        title: linkData.title,
        description: linkData.description || null,
        notes: linkData.notes || null,
        tags: linkData.tags || []
      })
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to update link');
    }

    return data;
  } catch (error) {
    console.error('Error updating link:', error);
    throw error;
  }
}

// Update the getLinks function to store links in local storage
async function getLinks() {
  try {
    const apiKey = await getApiKey();
    if (!apiKey) throw new Error('No API key found');

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.links}`, {
      headers: {
        'X-API-Key': apiKey
      }
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || 'Failed to fetch links');
    }

    // Store the fetched links in local storage
    chrome.storage.local.set({ savedLinks: data });

    return data;
  } catch (error) {
    console.error('Error fetching links:', error);
    throw error;
  }
}
// Helper function to get API key from storage
function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey'], (result) => resolve(result.apiKey));
  });
}

// Add missing helper function
function storeApiKey(apiKey) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ apiKey }, resolve);
  });
}