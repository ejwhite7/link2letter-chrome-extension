console.log('[Link2Letter Content Script] Loaded on:', window.location.href);

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[Link2Letter Content Script] Received message:', request);
  
  if (request.action === "getPageInfo") {
    try {
      const pageInfo = {
        url: window.location.href,
        title: document.title,
        description: getMetaContent('description') || getMetaContent('og:description') || ''
      };
      console.log('[Link2Letter Content Script] Sending page info:', pageInfo);
      sendResponse(pageInfo);
    } catch (error) {
      console.error('[Link2Letter Content Script] Error getting page info:', error);
      sendResponse({ error: error.message });
    }
  }
  return true; // This line is important for asynchronous response
});

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  const content = meta ? meta.getAttribute('content') : null;
  console.log(`[Link2Letter Content Script] Meta ${name}:`, content);
  return content;
}
