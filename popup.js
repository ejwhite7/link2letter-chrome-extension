import { CONFIG } from './config.js';
import { apiClient, ApiError } from './api-client.js';

const LINKS_PER_PAGE = 20;
const SELECT_MODE_TEXT = { enable: "Cancel", disable: "Select" };
const DEBUG = CONFIG.DEBUG;

// Add pagination constants
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

// Add language support
const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'de', 'zh', 'ja', 'ko', 'pt', 'it'];

// State
let currentTab = "save";
let currentPage = 1;
const selectedTags = new Set();
const activeFilters = new Set();
let currentEditId = null;
let currentLinks = []; // Store the current list of links
let hasShownPremiumPrompt = false;

// Fix 1: Add missing variable declarations for form elements
let urlInput;
let titleInput;
let descriptionInput;
let notesInput;
let tagsInput;
let submitButton;
let cancelEditButton;

// Add at the top of the file
let currentLoadLinksRequest = null;

// Event Listeners
document.addEventListener("DOMContentLoaded", init);

async function init() {
  try {
    // Initialize form elements with null checks
    const elements = {
      urlInput: document.getElementById('url'),
      titleInput: document.getElementById('title'),
      descriptionInput: document.getElementById('description'),
      notesInput: document.getElementById('notes'),
      tagsInput: document.getElementById('tagInput'),
      submitButton: document.getElementById('saveLink'),
      cancelEditButton: document.getElementById('cancelEdit'),
      apiKeyInput: document.getElementById('apiKey'),
      apiKeyStatus: document.getElementById('apiKeyStatus'),
      apiKeyEntry: document.getElementById('apiKeyEntry'),
      editApiKey: document.getElementById('editApiKey')
    };

    // Verify critical elements exist
    const requiredElements = ['titleInput', 'descriptionInput', 'tagsInput', 'submitButton'];
    for (const elementName of requiredElements) {
      if (!elements[elementName]) {
        throw new Error(`Required element ${elementName} not found in the DOM`);
      }
    }

    // Store elements globally but safely
    for (const [key, value] of Object.entries(elements)) {
      if (value) {
        window[key] = value;
      }
    }

    // Setup event listeners with cleanup
    const cleanup = setupEventListeners();
    
    // Add cleanup to window unload
    window.addEventListener('unload', cleanup);

    // Setup initial state
    await Promise.all([
      setupTabSwitching(),
      setupButtonListeners(),
      setupSortOrderDropdown(),
      loadInitialData(),
      loadRSSFeedURL()
    ]);

    // Load saved API key
    const apiKey = await apiClient.getApiKey();
    if (apiKey) {
      elements.apiKeyInput.value = apiKey;
      elements.apiKeyStatus.textContent = 'API key validated';
      elements.apiKeyStatus.style.color = 'green';
      elements.apiKeyEntry.style.display = 'none';
      elements.editApiKey.style.display = 'block';
      updateSaveLinkButton();
    }

    updateSaveLinkButton();
  } catch (error) {
    console.error('Initialization error:', error);
    showMessage(`Failed to initialize: ${error.message}`, 'error');
    throw error;
  }
}

// Add cleanup function for event listeners
function setupEventListeners() {
  const listeners = new Set();
  
  const addEventListenerWithCleanup = (element, event, handler) => {
    if (!element) {
      console.warn(`Element not found for event: ${event}`);
      return;
    }
    element.addEventListener(event, handler);
    listeners.add(() => element.removeEventListener(event, handler));
  };

  // Add event listeners for existing elements
  const elements = {
    saveLink: document.getElementById('saveLink'),
    cancelEdit: document.getElementById('cancelEdit'),
    tagInput: document.getElementById('tagInput'),
    // Add other elements as needed
  };

  // Setup listeners with null checks
  if (elements.saveLink) {
    addEventListenerWithCleanup(elements.saveLink, 'click', handleSave);
  }
  if (elements.cancelEdit) {
    addEventListenerWithCleanup(elements.cancelEdit, 'click', handleCancel);
  }
  if (elements.tagInput) {
    addEventListenerWithCleanup(elements.tagInput, 'keydown', handleTagInput);
  }

  // Return cleanup function
  return () => {
    for (const cleanup of listeners) {
      cleanup();
    }
    listeners.clear();
  };
}

async function handleSave(event) {
  event.preventDefault();
  
  try {
    let url = await getCurrentTabUrl();
    const removePaywall = document.getElementById("saveRemovePaywall")?.checked;

    if (removePaywall && !url.includes("12ft.io")) {
      url = `https://12ft.io/${url}`;
    }

    const linkData = {
      url: url,
      title: document.getElementById("title")?.value?.trim() || '',
      description: document.getElementById("description")?.value?.trim() || null,
      notes: document.getElementById("notes")?.value?.trim() || null,
      tags: getSelectedTags(),
    };

    if (!linkData.url || !linkData.title) {
      showMessage('URL and title are required', 'error');
      return;
    }

    await saveLinkData(linkData);
    showMessage('Link saved successfully!');
    resetForm();
  } catch (error) {
    console.error('Error saving link:', error);
    if (error instanceof ApiError) {
      if (error.code === 'LINK_LIMIT_REACHED' && !hasShownPremiumPrompt) {
        hasShownPremiumPrompt = true;
        showPremiumTab();
      } else {
        showMessage(error.message, 'error');
      }
    } else {
      showMessage(error.message || 'Failed to save link', 'error');
    }
  }
}

function setupTabSwitching() {
  const tabs = document.querySelectorAll(".tab");
  for (const tab of tabs) {
    tab.addEventListener("click", (e) => {
      e.preventDefault(); // Prevent default action
      const tabName = tab.dataset.tab;
      if (DEBUG) console.log("Tab clicked:", tabName);
      if (tabName) {
        switchTab(tabName);
      }
    });
  }
}

function setupButtonListeners() {
  // Helper function to safely add event listener
  const safeAddListener = (elementId, event, handler) => {
    const element = document.getElementById(elementId);
    if (element) {
      element.replaceWith(element.cloneNode(true));
      const newElement = document.getElementById(elementId);
      newElement.addEventListener(event, handler);
    }
  };

  // Add listeners for existing elements
  safeAddListener('saveLink', 'click', handleSave);
  safeAddListener('selectText', 'click', toggleSelectMode);
  safeAddListener('selectAll', 'click', selectAllLinks);
  safeAddListener('selectNone', 'click', selectNoLinks);
  safeAddListener('deleteSelected', 'click', deleteSelectedLinks);
  safeAddListener('sortOrder', 'change', loadSavedLinks);
  safeAddListener('tagInput', 'blur', addTag);
  safeAddListener('tagFilter', 'change', updateFilter);
  safeAddListener('editApiKey', 'click', showAPIKeyEntry);
  safeAddListener('validateApiKey', 'click', validateApiKey);
}

async function loadInitialData() {
  loadCurrentPageInfo();
  
  // Only load saved links and RSS feed URL if we have an API key
  const apiKey = await apiClient.getApiKey();
  if (apiKey) {
    loadSavedLinks();
    loadRSSFeedURL();
  }
}

async function loadSavedLinks(page = 1, pageSize = LINKS_PER_PAGE, filters = {}) {
  let controller;
  
  if (DEBUG) console.log('loadSavedLinks called with:', { page, pageSize, filters });
  
  try {
    // Cancel any ongoing request
    if (currentLoadLinksRequest) {
      currentLoadLinksRequest.abort();
    }

    controller = new AbortController();
    currentLoadLinksRequest = controller;

    const apiKey = await apiClient.getApiKey();
    if (!apiKey) {
      if (DEBUG) console.log('No API key found');
      throw new Error('No API key found');
    }

    const params = {
      page,
      limit: pageSize,
      ...(filters.tags && { tags: Array.from(activeFilters) }),
      ...(filters.search && { search: filters.search })
    };

    if (DEBUG) console.log('Fetching links with params:', params);
    const links = await apiClient.getLinks(apiKey, params);
    
    if (DEBUG) console.log('Received links:', links);
    currentLinks = links;
    displayLinks(links);
    
    // Update tags filter with all unique tags
    const allTags = [...new Set(links.flatMap(link => link.tags || []))];
    updateTagFilter(allTags);
    updateSelectButtonVisibility(links.length);
    
  } catch (error) {
    if (error.name === 'AbortError') return;
    
    console.error('Error loading links:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      code: error.code,
      stack: error.stack
    });
    
    if (error.message === 'No API key found') {
      showMessage('Please add your API key in the Settings tab', 'error');
      switchTab('settings');
    } else if (error.message.includes('Invalid response format')) {
      showMessage('Server returned invalid response. Please check your API key.', 'error');
    } else {
      showMessage(error.message || 'Failed to load links', 'error');
    }
  } finally {
    if (currentLoadLinksRequest === controller) {
      currentLoadLinksRequest = null;
    }
  }
}

function fallbackToLocalStorage() {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    if (result.savedLinks) {
      currentLinks = result.savedLinks;
      displayLinks(result.savedLinks);
      const allTags = [
        ...new Set(result.savedLinks.flatMap((link) => link.tags || [])),
      ];
      updateTagFilter(allTags);
      updateSelectButtonVisibility(result.savedLinks.length);
    }
  });
}

// Update hasSavedLinks to check both API and local storage
async function hasSavedLinks(callback) {
  try {
    const apiKey = await apiClient.getApiKey();
    if (apiKey) {
      try {
        const links = await apiClient.getLinks(apiKey);
        callback(links && links.length > 0);
        return;
      } catch (error) {
        console.error("Error checking API for links:", error);
      }
    }

    // Fallback to local storage
    chrome.storage.local.get({ savedLinks: [] }, (result) => {
      // Check the savedLinks array directly
      callback(result.savedLinks && result.savedLinks.length > 0);
    });
  } catch (error) {
    console.error("Error in hasSavedLinks:", error);
    callback(false);
  }
}

function switchTab(tabName) {
  if (DEBUG) console.log('Switching to tab:', tabName);
  
  // Hide all tab contents and remove active-content class
  const tabContents = document.querySelectorAll('.tab-content');
  for (const tab of tabContents) {
    tab.style.display = 'none';
    tab.classList.remove('active-content');
  }
  
  // Show selected tab content
  const selectedTab = document.getElementById(`${tabName}Tab`);
  if (selectedTab) {
    selectedTab.style.display = 'block';
    selectedTab.classList.add('active-content');
  }
  
  // Update active tab styling
  const tabs = document.querySelectorAll('.tab');
  for (const tab of tabs) {
    tab.classList.remove('active-tab');
  }
  
  const activeTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (activeTab) {
    activeTab.classList.add('active-tab');
  }
  
  // Update current tab state
  currentTab = tabName;
}

function toggleActiveClass(selector, activeId, className) {
  for (const element of document.querySelectorAll(selector)) {
    element.classList.toggle(
      className,
      element.dataset.tab === activeId || element.id === activeId
    );
  }
}

function loadCurrentPageInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || tabs.length === 0) {
      console.error("No active tab found");
      return;
    }
    
    const activeTab = tabs[0];
    if (DEBUG) console.log('Active tab:', activeTab);
    
    // Check if we can inject content scripts into this tab
    if (activeTab.url && (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('chrome-extension://'))) {
      if (DEBUG) console.log('Cannot inject content script into chrome:// or extension pages');
      // Just use the tab title
      setInputValue("title", activeTab.title || '');
      return;
    }
    
    // Send message to content script
    if (DEBUG) console.log('Sending getPageInfo message to tab:', activeTab.id);
    chrome.tabs.sendMessage(
      activeTab.id,
      { action: "getPageInfo" },
      handlePageInfoResponse
    );
  });
}

function handlePageInfoResponse(response) {
  if (chrome.runtime.lastError) {
    console.error('Chrome runtime error:', chrome.runtime.lastError);
    // Try to get basic info without content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        setInputValue("title", tabs[0].title || '');
      }
    });
    return;
  }
  if (response) {
    console.log('Received page info:', response);
    setInputValue("title", response.title);
    setInputValue("description", response.description);
  } else {
    console.error("No response from content script");
  }
}

function setInputValue(id, value) {
  const element = document.getElementById(id);
  if (element) {
    element.value = value || "";
  }
}

async function getCurrentTabUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        resolve(tabs[0].url);
      } else {
        reject(new Error("No active tab found"));
      }
    });
  });
}

function getSelectedTags() {
  return Array.from(selectedTags);
}

function saveLocally(linkData) {
  // Implementation of saveLocally function
}

function showMessage(message, type = "success") {
  const messageElement = document.getElementById("message");
  messageElement.textContent = message;
  messageElement.style.color = type === "success" ? "green" : "red";
  setTimeout(() => {
    messageElement.textContent = "";
  }, 3000);
}

async function updateTagFilter(tags) {
  const tagFilter = document.getElementById("tagFilter");
  tagFilter.innerHTML = '<option value="">Filter by tag</option>'; // Reset options
  
  // Try to get all user tags from the API
  try {
    const apiKey = await apiClient.getApiKey();
    if (apiKey) {
      const userTags = await apiClient.getUserTags(apiKey);
      // Merge with tags from current links
      const allTags = [...new Set([...tags, ...userTags])].sort();
      for (const tag of allTags) {
        const option = document.createElement("option");
        option.value = tag;
        option.textContent = tag;
        tagFilter.appendChild(option);
      }
      return;
    }
  } catch (error) {
    console.error('Error loading user tags:', error);
  }
  
  // Fallback to just using tags from current links
  for (const tag of tags) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    tagFilter.appendChild(option);
  }
}

function updateSelectButtonVisibility(linkCount) {
  const selectButton = document.getElementById("selectText");
  if (selectButton) {
    // Hide the select button if there are 0 or 1 links
    selectButton.style.display = linkCount > 1 ? "inline-block" : "none";
  }
}

function displayLinks(savedLinks) {
  if (DEBUG) console.log('displayLinks called with:', savedLinks);
  
  const linksList = document.getElementById('savedLinks');
  if (DEBUG) console.log('Found savedLinks element:', linksList);
  
  if (!linksList) {
    if (DEBUG) console.error('Could not find savedLinks tbody');
    return;
  }

  linksList.innerHTML = '';

  if (!Array.isArray(savedLinks)) {
    if (DEBUG) console.error('Expected links array, got:', savedLinks);
    return;
  }

  if (DEBUG) console.log(`Creating ${savedLinks.length} link rows...`);
  
  if (savedLinks.length === 0) {
    linksList.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 20px;">
          No links found. Save some links to see them here!
       </td>
      </tr>
    `;
    return;
  }

 for (const link of savedLinks) {
    if (DEBUG) console.log('Creating row for link:', link);
    const row = createLinkRow(link);
    if (DEBUG) console.log('Created row:', row);
    linksList.appendChild(row);
  }

  const linksTable = document.getElementById('savedLinksTable');
  if (linksTable) {
    linksTable.style.display = 'table';
  }

  updateSelectButtonVisibility(savedLinks.length);
}

function paginateLinks(savedLinks) {
  const startIndex = (currentPage - 1) * LINKS_PER_PAGE;
  const endIndex = startIndex + LINKS_PER_PAGE;
  return savedLinks.slice(startIndex, endIndex);
}

function createLinkRow(link) {
  if (DEBUG) console.log('Creating row for link:', link);
  
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="checkbox" data-link-id="${link.id}" style="display: none;"></td>
    <td class="title-cell">
      <a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
        ${escapeHtml(link.title) || escapeHtml(link.url)}
      </a>
      ${link.usePaywallRemover ? '<span class="paywall-badge">12ft.io</span>' : ''}
    </td>
    <td class="description-cell">${escapeHtml(link.description || '')}</td>
    <td class="tag-cell">${(link.tags || []).map(tag => escapeHtml(tag)).join(", ")}</td>
    <td>
      <button class="menu-btn" data-link-id="${link.id}">⋮</button>
      <div class="menu-actions" style="display: none;">
        <button class="action-btn edit-btn" data-action="edit" data-link-id="${link.id}">Edit</button>
        <button class="action-btn delete-btn" data-action="delete" data-link-id="${link.id}">Delete</button>
        <button class="action-btn view-btn" data-action="view" data-link-id="${link.id}">View URL</button>
        <button class="action-btn copy-btn" data-action="copy" data-link-id="${link.id}">Copy URL</button>
        <button class="action-btn open-btn" data-action="open" data-link-id="${link.id}">Open URL</button>
        ${link.notes ? `<button class="action-btn notes-btn" data-action="notes" data-link-id="${link.id}">View Notes</button>` : ''}
      </div>
    </td>
  `;

  // Add menu button click handler
  const menuBtn = row.querySelector('.menu-btn');
  const menuActions = row.querySelector('.menu-actions');
  
  if (menuBtn && menuActions) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      
      // Close all other open menus first
      const allMenus = document.querySelectorAll('.menu-actions');
      for (const menu of allMenus) {
        if (menu !== menuActions) {
          menu.style.display = 'none';
        }
      }
      
      // Toggle current menu
      const isOpen = menuActions.style.display === 'block';
      menuActions.style.display = isOpen ? 'none' : 'block';
      
      // Add click-outside handler if menu is now open
      if (!isOpen) {
        const clickOutsideHandler = (event) => {
          if (!menuActions.contains(event.target) && !menuBtn.contains(event.target)) {
            menuActions.style.display = 'none';
            document.removeEventListener('click', clickOutsideHandler);
          }
        };
        
        // Use setTimeout to avoid immediate trigger
        setTimeout(() => {
          document.addEventListener('click', clickOutsideHandler);
        }, 0);
      }
    });

    // Add action button handlers
    const actionButtons = menuActions.querySelectorAll('.action-btn');
    for (const btn of actionButtons) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const linkId = Number.parseInt(btn.dataset.linkId);
        
        // Close menu before handling action
        menuActions.style.display = 'none';
        
        // Handle the action
        handleLinkAction(action, linkId);
      });
    }
  }

  return row;
}

async function handleLinkAction(action, linkId) {
  const link = currentLinks.find(l => l.id === linkId);
  if (!link) {
    console.error('Link not found:', linkId);
    return;
  }

  switch (action) {
    case 'edit':
      editRSSItem(linkId);
      break;
    case 'delete':
      await deleteLink(linkId);
      break;
    case 'view':
      viewURL(link);
      break;
    case 'copy':
      copyLinkURL(link);
      break;
    case 'open':
      window.open(link.url, '_blank');
      break;
    case 'notes':
      viewNotes(link);
      break;
  }
}

async function deleteLink(linkId) {
  try {
    const apiKey = await apiClient.getApiKey();
    if (!apiKey) throw new Error('No API key found');

    await apiClient.deleteLink(apiKey, linkId);
    showMessage('Link deleted successfully');
    await loadSavedLinks();
  } catch (error) {
    console.error('Error deleting link:', error);
    showMessage(error.message || 'Failed to delete link', 'error');
  }
}

// Helper function to get API key
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey'], (result) => {
      resolve(result.apiKey || null);
    });
  });
}

async function setApiKey(apiKey) {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ apiKey }, resolve);
  });
}

function showUrlOverlay(url) {
  const overlay = createOverlay(`
    <h3>URL</h3>
    <p>${escapeHtml(url)}</p>
    <button class="close-btn">Close</button>
  `);
  document.body.appendChild(overlay);
}

function showNotesOverlay(notes) {
  const overlay = createOverlay(`
    <h3>Notes</h3>
    <p>${escapeHtml(notes || 'No notes available')}</p>
    <button class="close-btn">Close</button>
  `);
  document.body.appendChild(overlay);
}

function createOverlay(content) {
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `
    <div class="overlay-content">
      ${content}
    </div>
  `;
  
  overlay.querySelector('.close-btn').addEventListener('click', () => {
    document.body.removeChild(overlay);
  });
  
  return overlay;
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function toggleSelectMode() {
  const checkboxes = document.querySelectorAll(
    '#savedLinksTable input[type="checkbox"]'
  );
  const bulkActions = document.getElementById("bulkActions");
  const selectText = document.getElementById("selectText");
  const isSelectMode = checkboxes[0].style.display === "none";

  for (const checkbox of checkboxes) {
    checkbox.style.display = isSelectMode ? "inline" : "none";
  }
  bulkActions.style.display = isSelectMode ? "block" : "none";
  selectText.textContent = isSelectMode
    ? SELECT_MODE_TEXT.enable
    : SELECT_MODE_TEXT.disable;
}

function selectAllLinks() {
  toggleCheckboxes(true);
}

function selectNoLinks() {
  toggleCheckboxes(false);
}

function toggleCheckboxes(checked) {
  for (const checkbox of document.querySelectorAll(
    '#savedLinksTable input[type="checkbox"]'
  )) {
    checkbox.checked = checked;
  }
}

async function deleteSelectedLinks() {
  try {
    const selectedIds = [];
    const checkboxes = document.querySelectorAll(
      '#savedLinksTable input[type="checkbox"]:checked'
    );
    
    console.log('Found checkboxes:', checkboxes.length);
    
    for (const checkbox of checkboxes) {
      const linkId = Number.parseInt(checkbox.dataset.linkId);
      console.log('Checkbox linkId:', checkbox.dataset.linkId, 'Parsed:', linkId);
      if (linkId) selectedIds.push(linkId);
    }

    console.log('Selected IDs for deletion:', selectedIds);
    
    if (selectedIds.length === 0) {
      console.log('No links selected for deletion');
      return;
    }

    const apiKey = await apiClient.getApiKey();
    if (!apiKey) throw new Error('No API key found');

    console.log('Calling bulkDeleteLinks with IDs:', selectedIds);
    await apiClient.bulkDeleteLinks(apiKey, selectedIds);
    
    showMessage('Links deleted successfully', 'success');
    await loadSavedLinks();
    toggleSelectMode(); // Exit select mode
  } catch (error) {
    console.error('Error deleting links:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      code: error.code,
      stack: error.stack
    });
    showMessage(error.message || 'Failed to delete links. Please try again.', 'error');
  }
}

function getSelectedIndices() {
  return Array.from(
    document.querySelectorAll('#savedLinksTable input[type="checkbox"]:checked')
  ).map((checkbox) => Number.parseInt(checkbox.dataset.index));
}

function handleDeleteResponse(response) {
  if (response.success) {
    loadSavedLinks();
    document.getElementById("message").textContent = "Selected links deleted!";
  } else {
    alert("Failed to delete selected links.");
  }
}

function updatePagination(pagination) {
  const paginationElement = document.getElementById('pagination');
  if (!pagination) return;

  const { total, page, pageSize, totalPages } = pagination;
  let html = '';

  if (totalPages > 1) {
    // Previous page
    html += `<button ${page === 1 ? 'disabled' : ''} 
      onclick="changePage(${page - 1})">&laquo;</button>`;

    // Page numbers
    for (let i = 1; i <= totalPages; i++) {
      html += `<button ${i === page ? 'class="active"' : ''} 
        onclick="changePage(${i})">${i}</button>`;
    }

    // Next page
    html += `<button ${page === totalPages ? 'disabled' : ''} 
      onclick="changePage(${page + 1})">&raquo;</button>`;
  }

  paginationElement.innerHTML = html;
}

window.changePage = (newPage) => {
  currentPage = newPage;
  loadSavedLinks(currentPage);
};

// Removed unused menu popup functions - using inline menu approach instead

function viewURL(link) {
  if (!link) {
    console.error('Link not found');
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
      <div style="background-color: white; margin: 10% auto; padding: 20px; width: 80%;">
        <h2>URL</h2>
        <p id="urlDisplay">${link.url}</p>
        <input type="text" id="urlInput" value="${link.url}" style="display: none;">
        <div class="paywall-checkbox">
          <input type="checkbox" id="removePaywall" ${link.url.includes("12ft.io") ? "checked" : ""}>
          <label for="removePaywall">Remove Paywall with 12ft.io</label>
        </div>
        <button id="editURLBtn">Edit URL</button>
        <button id="saveURLBtn" style="display: none;">Save</button>
        <button id="closeOverlay">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const urlDisplay = document.getElementById("urlDisplay");
    const urlInput = document.getElementById("urlInput");
    const editURLBtn = document.getElementById("editURLBtn");
    const saveURLBtn = document.getElementById("saveURLBtn");

    editURLBtn.addEventListener("click", () => {
      urlDisplay.style.display = "none";
      urlInput.style.display = "block";
      editURLBtn.style.display = "none";
      saveURLBtn.style.display = "inline";
    });

    saveURLBtn.addEventListener("click", async () => {
      let newUrl = urlInput.value.trim();
      const removePaywall = document.getElementById("removePaywall").checked;

      if (!newUrl) {
        showMessage("URL cannot be empty", "error");
        return;
      }

      // Handle paywall removal
      if (removePaywall && !newUrl.includes("12ft.io")) {
        newUrl = `https://12ft.io/${newUrl}`;
      } else if (!removePaywall && newUrl.includes("12ft.io")) {
        newUrl = newUrl.replace("https://12ft.io/", "");
      }

      if (newUrl !== link.url) {
        try {
          const apiKey = await new Promise((resolve) => {
            chrome.storage.sync.get(["apiKey"], (result) =>
              resolve(result.apiKey)
             );
            });

          // Prepare updated link data - only include fields defined in the API spec
          const updatedLink = {
            url: newUrl,
            title: link.title,
            description: link.description || "",
            notes: link.notes || "",
            tags: link.tags || [],
          };

          if (apiKey && link.id) {
            // Update in API first
            const updatedLinkFromServer = await apiClient.updateLink(apiKey, link.id, updatedLink);
            Object.assign(link, updatedLinkFromServer); // Merge server response with current link
          } else {
            // If no API key or ID, just update the local data
            Object.assign(link, updatedLink);
          }

          // Update locally
          chrome.storage.local.get({ savedLinks: [] }, (result) => {
            const savedLinks = result.savedLinks;
            savedLinks[index] = link;
            chrome.storage.local.set({ savedLinks }, () => {
              loadSavedLinks();
              showMessage("URL updated successfully!");
            });
          });
        } catch (error) {
          console.error("Error updating URL:", error);
          showMessage("Error updating URL. Please try again.", "error");
        }
      }
      document.body.removeChild(overlay);
    });

    document.getElementById("closeOverlay").addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
}

// First instance - for copying by ID
function copyLinkURL(link) {
  if (!link) {
    console.error('Link not found');
    return;
  }
  
  navigator.clipboard.writeText(link.url).then(() => {
    showMessage("URL copied to clipboard!");
  }).catch(error => {
    console.error('Failed to copy URL:', error);
    showMessage("Failed to copy URL", "error");
  });
}

// Second instance - rename to copyLinkURLByIndex
function copyLinkURLByIndex(index) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const link = result.savedLinks[index];
    navigator.clipboard.writeText(link.url).then(() => {
      document.getElementById("message").textContent =
        "URL copied to clipboard!";
    });
  });
}

function viewNotes(link) {
  if (!link) {
    console.error('Link not found');
    return;
  }

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.7)";
    overlay.style.zIndex = "1001";
    overlay.innerHTML = `
      <div style="background-color: white; margin: 10% auto; padding: 20px; width: 80%;">
        <h2>Notes</h2>
        <p id="notesDisplay">${link.notes || "No notes available"}</p>
        <textarea id="notesInput" style="display: none;">${link.notes || ""}</textarea>
        <button id="editNotesBtn">Edit</button>
        <button id="saveNotesBtn" style="display: none;">Save</button>
        <button id="closeOverlay">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const notesDisplay = document.getElementById("notesDisplay");
    const notesInput = document.getElementById("notesInput");
    const editNotesBtn = document.getElementById("editNotesBtn");
    const saveNotesBtn = document.getElementById("saveNotesBtn");

    editNotesBtn.addEventListener("click", () => {
      notesDisplay.style.display = "none";
      notesInput.style.display = "block";
      editNotesBtn.style.display = "none";
      saveNotesBtn.style.display = "inline";
    });

    saveNotesBtn.addEventListener("click", () => {
      const newNotes = notesInput.value;
      if (newNotes !== link.notes) {
        link.notes = newNotes;
        currentLinks[index] = link;
        chrome.storage.local.set({ savedLinks: currentLinks }, () => {
          console.log("Notes updated:", currentLinks); // Debugging log
          loadSavedLinks();
          updateRSSFeed();
          document.getElementById("message").textContent =
            "Notes updated successfully!";
        });
      }
      document.body.removeChild(overlay);
    });

    document.getElementById("closeOverlay").addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
}

function editRSSItem(linkId) {
  const link = currentLinks.find(l => l.id === linkId);
  if (!link) {
    console.error("Link not found for ID:", linkId);
    return;
  }

    const menuButton = document.querySelector(`button[data-link-id="${linkId}"]`);
    if (!menuButton) {
      console.error("Menu button not found for link ID:", linkId);
      return;
    }
    const row = menuButton.closest('tr');
    if (!row) {
      console.error("Row not found for link ID:", linkId);
      return;
    }

    const titleCell = row.querySelector(".title-cell");
    const descriptionCell = row.querySelector(".description-cell");
    const tagCell = row.querySelector(".tag-cell");

    // Store original values and link ID
    row.dataset.originalTitle = titleCell.textContent;
    row.dataset.originalDescription = descriptionCell.textContent;
    row.dataset.originalTags = tagCell.textContent;
    row.dataset.linkId = linkId;

    // Replace content with editable fields
    const titleLink = titleCell.querySelector('a');
    const actualTitle = titleLink ? titleLink.textContent.trim() : link.title;
    const actualDescription = link.description || '';
    
    titleCell.innerHTML = `<input type="text" class="edit-title" value="${escapeHtml(actualTitle)}">`;
    descriptionCell.innerHTML = `<textarea class="edit-description">${escapeHtml(actualDescription)}</textarea>`;
    tagCell.innerHTML = `<input type="text" class="edit-tags" value="${escapeHtml(link.tags ? link.tags.join(', ') : '')}">`;

    // Change menu button to save button
    menuButton.textContent = "Save";
    menuButton.classList.add("save-btn");
    menuButton.classList.remove("menu-btn");

    // Add cancel button
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.classList.add("cancel-btn");
    cancelButton.onclick = () => {
      // Restore the original link data
      const originalLink = currentLinks.find(l => l.id === linkId);
      if (originalLink) {
        restoreRow(row, originalLink);
      } else {
        // Fallback to text restoration if link not found
        titleCell.textContent = row.dataset.originalTitle;
        descriptionCell.textContent = row.dataset.originalDescription;
        tagCell.textContent = row.dataset.originalTags;
        restoreMenuButton();
      }
    };
    menuButton.parentNode.insertBefore(cancelButton, menuButton);

    // Update menu button click handler
    menuButton.onclick = async () => {
      await saveRSSItemChanges(linkId, row);
      // restoreMenuButton is called within saveRSSItemChanges after successful save
    };

    function restoreMenuButton() {
      menuButton.textContent = "⋮";
      menuButton.classList.remove("save-btn");
      menuButton.classList.add("menu-btn");
      if (cancelButton.parentNode) {
        cancelButton.parentNode.removeChild(cancelButton);
      }
      // Remove the onclick handler - the original event listener will handle clicks
      menuButton.onclick = null;
    }
}

function restoreRow(row, link) {
  const titleCell = row.querySelector(".title-cell");
  const descriptionCell = row.querySelector(".description-cell");
  const tagCell = row.querySelector(".tag-cell");
  
  // Ensure link.url exists before using it
  const url = link.url || '';
  
  titleCell.innerHTML = `
    <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(link.title)}
    </a>
    ${url?.includes("12ft.io") ? '<span class="paywall-badge">12ft.io</span>' : ''}
  `;
  descriptionCell.textContent = link.description || '';
  tagCell.textContent = (link.tags || []).join(', ');
  
  // Restore menu button
  const menuButton = row.querySelector('.save-btn');
  const cancelButton = row.querySelector('.cancel-btn');
  
  if (menuButton) {
    menuButton.textContent = "⋮";
    menuButton.classList.remove("save-btn");
    menuButton.classList.add("menu-btn");
    menuButton.onclick = null;
  }
  
  if (cancelButton) {
    cancelButton.remove();
  }
}

async function saveRSSItemChanges(linkId, row) {
  console.log('saveRSSItemChanges called with linkId:', linkId);
  
  if (!linkId || !row) {
    showMessage('Invalid link data', 'error');
    return;
  }

  const newTitle = row.querySelector(".edit-title")?.value?.trim();
  const newDescription = row.querySelector(".edit-description")?.value?.trim();
  const newTags = row.querySelector(".edit-tags")?.value
    ?.split(',')
    ?.map(tag => tag.trim())
    ?.filter(tag => tag.length > 0) || [];

  console.log('Edit values:', { newTitle, newDescription, newTags });

  if (!newTitle) {
    showMessage("Title cannot be empty", "error");
    return;
  }

  try {
    const apiKey = await apiClient.getApiKey();
    if (!apiKey) throw new Error('No API key found');

    const link = currentLinks.find(l => l.id === linkId);
    if (!link) {
      throw new Error("Link not found");
    }

    // Only send the fields that can be updated via PATCH
    const updatePayload = {
      title: newTitle,
      description: newDescription || null,
      tags: newTags,
    };

    console.log('Sending update payload:', updatePayload);
    const savedLink = await apiClient.updateLink(apiKey, linkId, updatePayload);
    console.log('API response:', savedLink);
    
    // Merge the response with the original link to preserve URL and other fields
    const mergedLink = {
      ...link,
      ...savedLink,
      url: link.url // Ensure URL is preserved from original link
    };
    
    console.log('Merged link:', mergedLink);
    
    // Update local state
    const linkIndex = currentLinks.findIndex(l => l.id === linkId);
    if (linkIndex !== -1) {
      currentLinks[linkIndex] = mergedLink;
    }
    
    showMessage("Link updated successfully!");
    restoreRow(row, mergedLink);
    
  } catch (error) {
    console.error("Error updating link:", error);
    showMessage(error.message || "Failed to update link", "error");
    // Don't restore the row on error - let user fix and try again
  }
}

async function getSavedLinks() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ savedLinks: [] }, (result) => {
      resolve(result.savedLinks);
    });
  });
}

// updateLinkOnServer function removed - now using apiClient.updateLink

async function updateLocalStorage(updatedLink, savedLinks, linkId) {
  const linkIndex = savedLinks.findIndex(l => l.id === linkId);
  if (linkIndex !== -1) {
    savedLinks[linkIndex] = updatedLink;
    await new Promise((resolve) => {
      chrome.storage.local.set({ savedLinks }, resolve);
    });
  }
}

function editURL(linkId, useIndex = false) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const link = useIndex ? result.savedLinks[linkId] : result.savedLinks.find(l => l.id === linkId);
    if (!link) {
      console.error('Link not found');
      return;
    }

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.backgroundColor = "rgba(0,0,0,0.7)";
    overlay.style.zIndex = "1001";
    overlay.innerHTML = `
      <div style="background-color: white; margin: 10% auto; padding: 20px; width: 80%;">
        <h2>URL</h2>
        <p id="urlDisplay">${link.url}</p>
        <input type="text" id="urlInput" value="${link.url}" style="display: none;">
        <div class="paywall-checkbox">
          <input type="checkbox" id="removePaywall" ${link.url.includes("12ft.io") ? "checked" : ""}>
          <label for="removePaywall">Remove Paywall with 12ft.io</label>
        </div>
        <button id="editURLBtn">Edit URL</button>
        <button id="saveURLBtn" style="display: none;">Save</button>
        <button id="closeOverlay">Close</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const urlDisplay = document.getElementById("urlDisplay");
    const urlInput = document.getElementById("urlInput");
    const editURLBtn = document.getElementById("editURLBtn");
    const saveURLBtn = document.getElementById("saveURLBtn");

    editURLBtn.addEventListener("click", () => {
      urlDisplay.style.display = "none";
      urlInput.style.display = "block";
      editURLBtn.style.display = "none";
      saveURLBtn.style.display = "inline";
    });

    saveURLBtn.addEventListener("click", async () => {
      let newUrl = urlInput.value.trim();
      const removePaywall = document.getElementById("removePaywall").checked;

      if (!newUrl) {
        showMessage("URL cannot be empty", "error");
        return;
      }

      // Handle paywall removal
      if (removePaywall && !newUrl.includes("12ft.io")) {
        newUrl = `https://12ft.io/${newUrl}`;
      } else if (!removePaywall && newUrl.includes("12ft.io")) {
        newUrl = newUrl.replace("https://12ft.io/", "");
      }

      if (newUrl !== link.url) {
        try {
          const apiKey = await new Promise((resolve) => {
            chrome.storage.sync.get(["apiKey"], (result) =>
              resolve(result.apiKey)
             );
            });

          // Prepare updated link data - only include fields defined in the API spec
          const updatedLink = {
            url: newUrl,
            title: link.title,
            description: link.description || "",
            notes: link.notes || "",
            tags: link.tags || [],
          };

          if (apiKey && link.id) {
            // Update in API first
            const updatedLinkFromServer = await apiClient.updateLink(apiKey, link.id, updatedLink);
            Object.assign(link, updatedLinkFromServer); // Merge server response with current link
          } else {
            // If no API key or ID, just update the local data
            Object.assign(link, updatedLink);
          }

          // Update locally
          chrome.storage.local.get({ savedLinks: [] }, (result) => {
            const savedLinks = result.savedLinks;
            savedLinks[index] = link;
            chrome.storage.local.set({ savedLinks }, () => {
              loadSavedLinks();
              showMessage("URL updated successfully!");
            });
          });
        } catch (error) {
          console.error("Error updating URL:", error);
          showMessage("Error updating URL. Please try again.", "error");
        }
      }
      document.body.removeChild(overlay);
    });

    document.getElementById("closeOverlay").addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
  });
}

function addTag() {
  const tagInput = document.getElementById("tagInput");
  const tags = new Set(
    tagInput.value
      .split(",")
      .map(tag => tag.trim().toLowerCase())
      .filter(tag => tag && tag.length <= 50)
  );

  for (const tag of tags) {
    selectedTags.add(tag);
  }

  updateSelectedTagsDisplay();
  tagInput.value = "";
}

function updateSelectedTagsDisplay() {
  const container = document.getElementById("selectedTags");
  container.innerHTML = "";
  for (const tag of selectedTags) {
    const tagElement = document.createElement("span");
    tagElement.textContent = tag;
    tagElement.classList.add("tag");
    tagElement.addEventListener("click", () => {
      selectedTags.delete(tag);
      updateSelectedTagsDisplay();
    });
    container.appendChild(tagElement);
  }
}

function loadAllTags() {
  chrome.runtime.sendMessage({ action: "getSavedLinks" }, (response) => {
    const tagFilter = document.getElementById("tagFilter");
    tagFilter.innerHTML = '<option value="">Filter by tag</option>';
    const allTags = new Set();

    for (const link of response.savedLinks) {
      for (const tag of link.tags) {
        allTags.add(tag);
      }
    }

    for (const tag of allTags) {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = tag;
      tagFilter.appendChild(option);
    }
  });
}

function updateFilter() {
  const selectedTag = document.getElementById("tagFilter").value;
  if (selectedTag) {
    activeFilters.add(selectedTag);
  }
  updateActiveFiltersDisplay();
  loadSavedLinks();
}

function updateActiveFiltersDisplay() {
  const container = document.getElementById("activeFilters");
  container.innerHTML = "";
  for (const tag of activeFilters) {
    const tagElement = document.createElement("span");
    tagElement.textContent = tag;
    tagElement.classList.add("active-filter");
    tagElement.addEventListener("click", () => {
      activeFilters.delete(tag);
      updateActiveFiltersDisplay();
      loadSavedLinks();
    });
    container.appendChild(tagElement);
  }
}

// Load saved API key on popup open
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await init();
  } catch (error) {
    console.error('Failed to initialize extension:', error);
    showMessage('Failed to initialize extension', 'error');
  }
});

// Load RSS feed URL if API key exists
async function loadRSSFeedURL() {
  try {
    const apiKey = await apiClient.getApiKey();
    if (!apiKey) {
      document.getElementById("rssFeedSection").style.display = "none";
      return;
    }

    const feedUrl = await apiClient.getRssFeedUrl(apiKey);
    if (feedUrl) {
      const rssFeedUrl = document.getElementById("rssFeedUrl");
      if (rssFeedUrl) {
        document.getElementById("rssFeedSection").style.display = "block";
        rssFeedUrl.textContent = feedUrl;
        
        // Add click to copy functionality
        rssFeedUrl.addEventListener('click', () => {
          navigator.clipboard.writeText(feedUrl).then(() => {
            showMessage("RSS feed URL copied to clipboard!");
          });
        });
      }
    } else {
      document.getElementById("rssFeedSection").style.display = "none";
    }
  } catch (error) {
    console.error("Error loading RSS feed URL:", error);
    document.getElementById("rssFeedSection").style.display = "none";
  }
}

// Update RSS feed when links change
async function updateRSSFeed() {
  // RSS feed updates automatically when links are changed via API
  // No need to manually update
}

// Clear API key and related data
function clearAPIKey() {
  chrome.storage.sync.remove(["apiKey"], () => {
    document.getElementById("apiKey").value = "";
    document.getElementById("rssFeedSection").style.display = "none";
    document.getElementById("apiKeyStatus").textContent = "";
    updateSaveLinkButton();
  });
}

function showAPIKeyEntry() {
  document.getElementById("apiKeyEntry").style.display = "block";
  document.getElementById("editApiKey").style.display = "none"; // Hide edit button when showing entry
  updateSaveLinkButton();
}

function hideAPIKeyEntry() {
  document.getElementById("apiKeyEntry").style.display = "none";
  document.getElementById("editApiKey").style.display = "block"; // Only show edit button after successful validation
  updateSaveLinkButton();
}

// Add this function to check API key status and update UI
function updateSaveLinkButton() {
  const saveButton = document.getElementById("saveLink");
  const saveMessage = document.getElementById("saveMessage");

  apiClient.getApiKey().then(apiKey => {
    if (apiKey) {
      saveButton.disabled = false;
      saveButton.classList.remove("disabled");
      saveMessage.style.display = "none";
    } else {
      saveButton.disabled = true;
      saveButton.classList.add("disabled");
      saveMessage.style.display = "block";
      saveMessage.textContent =
        "Please enter an API key in Settings to save links";
    }
  });
}

// Update the HTML for the sort order dropdown to default to newest first
function setupSortOrderDropdown() {
  const sortOrder = document.getElementById("sortOrder");
  sortOrder.value = "newest"; // Set default value to newest
}

// Fix 2: Update handleSubmit to handle missing URL input
async function handleSubmit(event) {
  event.preventDefault();
  
  try {
    // Get URL from current tab if URL input is not present
    const url = urlInput ? urlInput.value.trim() : await getCurrentTabUrl();
    
    const linkData = {
      url,
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim() || null,
      notes: notesInput.value.trim() || null,
      tags: tagsInput.value ? tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : []
    };

    // Validate required fields
    if (!linkData.url || !linkData.title) {
      throw new Error('URL and title are required');
    }

    let result;
    if (currentEditId) {
      result = await chrome.runtime.sendMessage({
        action: 'updateLink',
        data: { ...linkData, id: currentEditId }
      });
    } else {
      result = await chrome.runtime.sendMessage({
        action: 'createLink',
        data: linkData
      });
    }

    if (result.error) {
      if (result.code === 'LINK_LIMIT_REACHED' && !hasShownPremiumPrompt) {
        hasShownPremiumPrompt = true;
        showPremiumTab();
      } else {
        throw new Error(result.error);
      }
      return;
    }

    await loadSavedLinks();
    showMessage(currentEditId ? 'Link updated successfully!' : 'Link saved successfully!');
    resetForm();
  } catch (error) {
    showMessage(error.message || 'Failed to save link', 'error');
  }
}

function setEditMode(linkId) {
  const link = currentLinks.find(l => l.id === linkId);
  if (!link) {
    showMessage('Link not found', 'error');
    return;
  }

  // Get all required input elements
  const titleInput = document.getElementById('title');
  const descriptionInput = document.getElementById('description');
  const notesInput = document.getElementById('notes');
  const saveLinkButton = document.getElementById('saveLink');

  // Set values and trim whitespace
  titleInput.value = (link.title || '').trim();
  descriptionInput.value = (link.description || '').trim();
  notesInput.value = (link.notes || '').trim();
  
  // Update tags
  selectedTags.clear();
  if (link.tags) {
    for (const tag of link.tags) {
      selectedTags.add(tag);
    }
  }
  updateSelectedTagsDisplay();
  
  // Set edit mode
  currentEditId = linkId;
  saveLinkButton.textContent = 'Update Link';
}

// Fix 3: Update resetForm to handle potentially missing elements
function resetForm() {
  currentEditId = null;
  if (urlInput) urlInput.value = '';
  if (titleInput) titleInput.value = '';
  if (descriptionInput) descriptionInput.value = '';
  if (notesInput) notesInput.value = '';
  if (tagsInput) tagsInput.value = '';
  
  if (submitButton) submitButton.textContent = 'Save Link';
  if (cancelEditButton) cancelEditButton.style.display = 'none';
}

// Fix 4: Add null check for premium tab elements
function showPremiumTab() {
  const premiumTab = document.getElementById('premiumTab');
  if (!premiumTab) {
    console.error('Premium tab element not found');
    return;
  }

  // Hide all other tabs
  for (const tab of document.querySelectorAll('.tab-content')) {
    tab.classList.remove('active-content');
  }
  
  // Show premium tab
  premiumTab.classList.add('active-content');
}

// Add event listener for dismiss button
document.getElementById('dismissPremium').addEventListener('click', () => {
  document.getElementById('premiumTab').classList.remove('active-content');
  document.getElementById('saveTab').classList.add('active-content');
});

// Add user preferences support
async function loadUserPreferences() {
  // Preferences loading can be implemented when the API supports it
  // For now, use default preferences
}

function applyUserPreferences(preferences) {
  // Apply theme
  document.body.setAttribute('data-theme', preferences.theme);
  
  // Apply language
  if (preferences.language) {
    document.documentElement.lang = preferences.language;
  }
}

// Add subscription status check
async function checkSubscriptionStatus() {
  // Subscription status can be checked when the API supports it
  // For now, assume free tier
}

function updateUIBasedOnSubscription(subscriptionInfo) {
  const { tier, linkLimit, currentLinks } = subscriptionInfo;
  
  // Update link counter
  document.getElementById('linkCounter').textContent = 
    `${currentLinks} / ${linkLimit} links used`;
    
  // Show/hide premium features
  const premiumFeatures = document.querySelectorAll('.premium-feature');
  for (const feature of premiumFeatures) {
    feature.style.display = tier === 'paid' ? 'block' : 'none';
  }
}

function getUserLanguage() {
  return document.documentElement.lang || 'en';
}

// Add a helper function to get standard headers
function getApiHeaders(apiKey) {
  return {
    "Accept": "application/json",
    "Content-Type": "application/json",
    "X-API-Key": apiKey,
    "Accept-Language": getUserLanguage()
  };
}

async function saveLinkData(linkData) {
  const apiKey = await apiClient.getApiKey();
  if (!apiKey) {
    throw new Error('No API key found');
  }

  if (currentEditId) {
    const updatedLink = await apiClient.updateLink(apiKey, currentEditId, linkData);
    // Update local state
    const linkIndex = currentLinks.findIndex(l => l.id === currentEditId);
    if (linkIndex !== -1) {
      currentLinks[linkIndex] = updatedLink;
    }
  } else {
    const newLink = await apiClient.createLink(apiKey, linkData);
    currentLinks.unshift(newLink); // Add to beginning of list
  }

  await loadSavedLinks();
}

function handleCancel() {
  resetForm();
  showMessage('Edit cancelled');
}

function handleTagInput(event) {
  if (event.key === 'Enter' || event.key === ',') {
    event.preventDefault();
    addTag();
  }
}

async function validateApiKey() {
  const apiKeyInput = document.getElementById('apiKey');
  const apiKey = apiKeyInput.value.trim();
  const statusElement = document.getElementById('apiKeyStatus');
  const apiKeyEntry = document.getElementById('apiKeyEntry');
  const editApiKey = document.getElementById('editApiKey');

  if (!apiKey) {
    statusElement.textContent = 'Please enter an API key';
    statusElement.style.color = 'red';
    return;
  }

  if (DEBUG) console.log('Validating API key:', apiKey);

  try {
    // Validate the API key
    const result = await apiClient.validateApiKey(apiKey);
    
    if (DEBUG) console.log('Validation result:', result);
    
    if (result.valid) {
      // Save the API key
      await apiClient.setApiKey(apiKey);

      // Update UI elements
      statusElement.textContent = 'API key validated successfully!';
      statusElement.style.color = 'green';
      apiKeyEntry.style.display = 'none';
      editApiKey.style.display = 'block';
      
      // Refresh links display and RSS feed URL
      await Promise.all([
        loadSavedLinks(),
        loadRSSFeedURL()
      ]);
      updateSaveLinkButton();
    } else {
      throw new Error('Invalid API key');
    }

  } catch (error) {
    console.error('Error validating API key:', error);
    console.error('Error details:', {
      message: error.message,
      status: error.status,
      code: error.code,
      stack: error.stack
    });
    
    let errorMessage = 'Error validating API key. Please try again.';
    
    if (error instanceof ApiError) {
      if (error.status === 401) {
        errorMessage = 'Invalid API key';
      } else if (error.status === 500) {
        errorMessage = 'Server error. Please try again later.';
      } else if (error.status === 0) {
        errorMessage = 'Network error. Please check your connection.';
      } else {
        errorMessage = error.message || errorMessage;
      }
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Network error. Please check your connection.';
    }
    
    statusElement.textContent = errorMessage;
    statusElement.style.color = 'red';
    await apiClient.setApiKey(''); // Clear invalid API key
  }
}

function updateLinksDisplay(data) {
  if (!data || !Array.isArray(data.links)) {
    console.error('Invalid data format received');
    return;
  }

  // Store current links globally
  currentLinks = data.links;

  // Display the links
  displayLinks(data.links);

  // Update pagination if total count is provided
  if (data.totalCount) {
    const totalPages = Math.ceil(data.totalCount / DEFAULT_PAGE_SIZE);
    updatePagination(currentPage, totalPages);
  }

  // Extract and update tags filter
  const allTags = [...new Set(data.links.flatMap(link => link.tags || []))];
  updateTagFilter(allTags);

  // Update select button visibility
  updateSelectButtonVisibility(data.links.length);
}
