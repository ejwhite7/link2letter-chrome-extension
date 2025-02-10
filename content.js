chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getPageInfo") {
    const pageInfo = {
      url: window.location.href,
      title: document.title,
      description: getMetaContent('description') || getMetaContent('og:description') || ''
    };
    sendResponse(pageInfo);
  }
  return true; // This line is important for asynchronous response
});

function getMetaContent(name) {
  const meta = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
  return meta ? meta.getAttribute('content') : null;
}
