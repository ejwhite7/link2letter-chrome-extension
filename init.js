document.addEventListener('DOMContentLoaded', async () => {
  try {
    // Wait for popup.js to load and initialize
    if (window.init) {
      await window.init();
    } else {
      throw new Error('Init function not found');
    }
  } catch (error) {
    console.error('Initialization failed:', error);
    const messageEl = document.getElementById('message');
    if (messageEl) {
      messageEl.textContent = 'Failed to initialize. Please try again.';
      messageEl.className = 'error';
    }
  }
});

async function loadSavedLinks(page = 1, pageSize = DEFAULT_PAGE_SIZE, filters = {}) {
  try {
    if (currentLoadLinksRequest) {
      currentLoadLinksRequest.abort();
    }

    const controller = new AbortController();
    currentLoadLinksRequest = controller;

    const apiKey = await getApiKey();
    if (!apiKey) {
      // Handle no API key case gracefully
      document.getElementById('savedLinks').innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 20px;">
            Please add your API key in the Settings tab to view your saved links.
          </td>
        </tr>
      `;
      return;
    }
    // ... rest of the function
  } catch (error) {
    // ... error handling
  }
}
