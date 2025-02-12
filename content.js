chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    try {
      const pageInfo = {
        url: window.location.href,
        title: document.title,
        description: getMetaContent('description') || getMetaContent('og:description') || ''
      };
      sendResponse(pageInfo);
    } catch (error) {
      console.error('Error getting page info:', error);
      sendResponse({ error: error.message });
    }
  }
  return true; // This line is important for asynchronous response
});

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  return meta ? meta.getAttribute('content') : null;
}
