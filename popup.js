// Constants
const LINKS_PER_PAGE = 5;
const SELECT_MODE_TEXT = { enable: "Cancel", disable: "Select" };

// Constants for API endpoints
const API_BASE_URL =
  "https://app.link2letter.com";
const VALIDATE_ENDPOINT = `${API_BASE_URL}/api/feed-url`;
const GET_LINKS_ENDPOINT = `${API_BASE_URL}/api/links`;
const LINK_SUBMIT_ENDPOINT = `${API_BASE_URL}/api/links`;
const LINK_DELETE_ENDPOINT = `${API_BASE_URL}/api/links`;
const LINK_EDIT_ENDPOINT = `${API_BASE_URL}/api/links`;

// State
let currentTab = "save";
const currentPage = 1;
const selectedTags = new Set();
const activeFilters = new Set();
let currentEditId = null;
let currentLinks = []; // Store the current list of links
let hasShownPremiumPrompt = false;

// Event Listeners
document.addEventListener("DOMContentLoaded", init);

function init() {
  setupTabSwitching();
  setupButtonListeners();
  setupSortOrderDropdown();
  loadInitialData();
  loadRSSFeedURL();
  updateSaveLinkButton();
}

function setupTabSwitching() {
  for (const tab of document.querySelectorAll(".tab")) {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      if (tabName === "view") {
        hasSavedLinks((hasLinks) => {
          if (!hasLinks) {
            alert("No saved links available.");
            return;
          }
          switchTab(tabName);
        });
      } else {
        switchTab(tabName);
      }
    });
  }
}

function setupButtonListeners() {
  document.getElementById("saveLink").addEventListener("click", async () => {
    let url = await getCurrentTabUrl();
    const removePaywall = document.getElementById("saveRemovePaywall").checked;

    // Add paywall removal if checked
    if (removePaywall && !url.includes("12ft.io")) {
      url = `https://12ft.io/${url}`;
    }

    const linkData = {
      url: url,
      title: document.getElementById("title").value.trim(),
      description: document.getElementById("description").value.trim() || null,
      notes: document.getElementById("notes").value.trim() || null,
      tags: getSelectedTags(),
    };

    // Validate required fields
    if (!linkData.url || !linkData.title) {
      showMessage("URL and title are required", "error");
      return;
    }

    try {
      const apiKey = await new Promise((resolve) => {
        chrome.storage.sync.get(["apiKey"], (result) => resolve(result.apiKey));
      });

      if (apiKey) {
        const response = await fetch(LINK_SUBMIT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-API-Key": apiKey,
          },
          body: JSON.stringify(linkData),
        });

        if (response.status === 201) {
          const savedLink = await response.json();
          // Store the link locally with its ID from the server
          chrome.storage.local.get({ savedLinks: [] }, (result) => {
            const savedLinks = result.savedLinks;
            savedLinks.push(savedLink);
            chrome.storage.local.set({ savedLinks }, () => {
              showMessage("Link saved successfully!");
              // Switch to the view tab after successful save
              switchTab("view");
              // Update the active tab UI
              document
                .querySelector('.tab[data-tab="save"]')
                .classList.remove("active-tab");
              document
                .querySelector('.tab[data-tab="view"]')
                .classList.add("active-tab");
            });
          });
        } else {
          const errorData = await response.json();
          throw new Error(errorData.error || "Failed to save link to server");
        }
      }
    } catch (error) {
      console.error("Error saving link:", error);
      showMessage(error.message, "error");
    }
  });
  document
    .getElementById("selectText")
    .addEventListener("click", toggleSelectMode);

  // Update event listeners for links
  document.getElementById("selectAll").addEventListener("click", (e) => {
    e.preventDefault(); // Prevent default link behavior
    selectAllLinks();
  });
  document.getElementById("selectNone").addEventListener("click", (e) => {
    e.preventDefault(); // Prevent default link behavior
    selectNoLinks();
  });
  document.getElementById("deleteSelected").addEventListener("click", (e) => {
    e.preventDefault(); // Prevent default link behavior
    deleteSelectedLinks();
  });

  document
    .getElementById("sortOrder")
    .addEventListener("change", loadSavedLinks);
  document.getElementById("tagInput").addEventListener("blur", addTag);
  document.getElementById("tagInput").addEventListener("keyup", (e) => {
    if (e.key === "," || e.key === "Enter") {
      addTag();
    }
  });
  document.getElementById("tagFilter").addEventListener("change", updateFilter);

  document
    .getElementById("editApiKey")
    .addEventListener("click", showAPIKeyEntry);

  // Handle API key validation
  document
    .getElementById("validateApiKey")
    .addEventListener("click", async () => {
      const apiKey = document.getElementById("apiKey").value;
      const statusElement = document.getElementById("apiKeyStatus");

      try {
        const response = await fetch(VALIDATE_ENDPOINT, {
          method: "GET",
          headers: {
            "X-API-Key": apiKey,
          },
        });

        if (response.ok) {
          const data = await response.json();
          chrome.storage.sync.set({ apiKey: apiKey }, () => {
            console.log("API key saved");
          });

          statusElement.style.color = "green";
          statusElement.textContent = "API key validated successfully!";
          document.getElementById("rssFeedSection").style.display = "block";
          document.getElementById("rssFeedUrl").textContent = data.feedUrl;
          hideAPIKeyEntry();
        } else {
          const errorData = await response.json();
          statusElement.style.color = "red";
          statusElement.textContent = errorData.message || "Invalid API key";
        }
      } catch (error) {
        statusElement.style.color = "red";
        statusElement.textContent =
          "Error validating API key. Please try again.";
        console.error("Error:", error);
      }
    });

  // Add account link handler
  document.getElementById("accountLink").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: API_BASE_URL });
  });
}

function loadInitialData() {
  loadCurrentPageInfo();
  loadSavedLinks();
  loadRSSFeedURL();
  if (currentTab === "view") loadSavedLinks();
}

async function loadSavedLinks() {
  try {
    // Get API key
    const apiKey = await new Promise((resolve) => {
      chrome.storage.sync.get(["apiKey"], (result) => resolve(result.apiKey));
    });

    if (apiKey) {
      // Fetch links from server
      const response = await fetch(GET_LINKS_ENDPOINT, {
        method: "GET",
        headers: {
          "X-API-Key": apiKey,
        },
      });

      if (response.ok) {
        const links = await response.json();
        // Store links locally and display them
        chrome.storage.local.set({ savedLinks: links }, () => {
          currentLinks = links; // Store the links locally
          displayLinks(links);
          // Extract all unique tags from the links
          const allTags = [
            ...new Set(links.flatMap((link) => link.tags || [])),
          ];
          updateTagFilter(allTags);
          updateSelectButtonVisibility(links.length);
        });
      } else {
        console.error("Failed to fetch links from server");
        // Fallback to local storage if API fails
        fallbackToLocalStorage();
      }
    } else {
      // No API key, use local storage
      fallbackToLocalStorage();
    }
  } catch (error) {
    console.error("Error loading links:", error);
    fallbackToLocalStorage();
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
function hasSavedLinks(callback) {
  chrome.storage.sync.get(["apiKey"], async (result) => {
    if (result.apiKey) {
      try {
        const response = await fetch(GET_LINKS_ENDPOINT, {
          method: "GET",
          headers: {
            "X-API-Key": result.apiKey,
          },
        });

        if (response.ok) {
          const links = await response.json();
          callback(links && links.length > 0);
          return;
        }
      } catch (error) {
        console.error("Error checking API for links:", error);
      }
    }

    // Fallback to local storage
    chrome.storage.local.get({ savedLinks: [] }, (result) => {
      callback(result.savedLinks && result.savedLinks.length > 0);
    });
  });
}

function switchTab(tabName) {
  currentTab = tabName;
  toggleActiveClass(".tab", tabName, "active-tab");
  toggleActiveClass(".tab-content", `${tabName}Tab`, "active-content");
  if (tabName === "view") {
    loadSavedLinks();
  } else {
    loadCurrentPageInfo();
  }
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
    if (tabs[0]) {
      chrome.tabs.sendMessage(
        tabs[0].id,
        { action: "getPageInfo" },
        handlePageInfoResponse
      );
    } else {
      console.error("No active tab found");
    }
  });
}

function handlePageInfoResponse(response) {
  if (chrome.runtime.lastError) {
    console.error(chrome.runtime.lastError);
    return;
  }
  if (response) {
    setInputValue("title", response.title);
    setInputValue("description", response.description);
  } else {
    console.error("No response from content script");
  }
}

function setInputValue(id, value) {
  document.getElementById(id).value = value || "";
}

function getCurrentTabUrl() {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        resolve(tabs[0].url);
      } else {
        console.error("No active tab found");
        resolve("");
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

function updateTagFilter(tags) {
  const tagFilter = document.getElementById("tagFilter");
  tagFilter.innerHTML = '<option value="">Filter by tag</option>'; // Reset options
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
  const linksList = document.getElementById("savedLinks");
  linksList.innerHTML = "";

  // First filter the links
  const filteredLinks = savedLinks.filter(
    (link) =>
      activeFilters.size === 0 ||
      Array.from(activeFilters).every((tag) => link.tags.includes(tag))
  );

  // Sort links by createdAt date, newest first by default
  const sortedLinks = [...filteredLinks].sort((a, b) => {
    const sortOrder = document.getElementById("sortOrder").value;
    const dateA = new Date(a.createdAt);
    const dateB = new Date(b.createdAt);

    return sortOrder === "oldest" ? dateA - dateB : dateB - dateA;
  });

  const linksToShow = paginateLinks(sortedLinks);

  for (const link of linksToShow) {
    const row = createLinkRow(link);
    linksList.appendChild(row);
  }

  updatePagination(filteredLinks.length);
}

function paginateLinks(savedLinks) {
  const startIndex = (currentPage - 1) * LINKS_PER_PAGE;
  const endIndex = startIndex + LINKS_PER_PAGE;
  return savedLinks.slice(startIndex, endIndex);
}

function createLinkRow(link) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td><input type="checkbox" data-link-id="${link.id}" style="display: none;"></td>
    <td class="title-cell">${escapeHtml(link.title)}</td>
    <td class="description-cell">${escapeHtml(link.description || '')}</td>
    <td class="tag-cell">${(link.tags || []).join(", ")}</td>
    <td>
      <button class="menu-btn" data-link-id="${link.id}">...</button>
      <div class="menu-actions" style="display: none;">
        <button class="action-btn edit-btn" data-action="edit">Edit</button>
        <button class="action-btn delete-btn" data-action="delete">Delete</button>
        <button class="action-btn view-btn" data-action="view">View URL</button>
        <button class="action-btn copy-btn" data-action="copy">Copy URL</button>
        <button class="action-btn open-btn" data-action="open">Open URL</button>
        <button class="action-btn notes-btn" data-action="notes">View Notes</button>
      </div>
    </td>
  `;

  // Add menu button click handler
  const menuBtn = row.querySelector('.menu-btn');
  const menuActions = row.querySelector('.menu-actions');
  
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close all other open menus first
    for (const menu of document.querySelectorAll('.menu-actions')) {
      if (menu !== menuActions) menu.style.display = 'none';
    }
    menuActions.style.display = menuActions.style.display === 'none' ? 'block' : 'none';
  });

  // Add action button handlers
  for (const btn of row.querySelectorAll('.action-btn')) {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const linkId = menuBtn.dataset.linkId;
      menuActions.style.display = 'none';

      try {
        const link = currentLinks.find(l => l.id === Number.parseInt(linkId));
        if (!link) throw new Error('Link not found');

        switch (action) {
          case 'edit': {
            // Don't switch tab automatically
            const titleCell = row.querySelector(".title-cell");
            const descriptionCell = row.querySelector(".description-cell");

            // Store original values
            row.dataset.originalTitle = titleCell.textContent;
            row.dataset.originalDescription = descriptionCell.textContent;

            // Replace content with editable fields
            titleCell.innerHTML = `<input type="text" class="edit-title" value="${escapeHtml(titleCell.textContent)}">`;
            descriptionCell.innerHTML = `<textarea class="edit-description">${escapeHtml(descriptionCell.textContent)}</textarea>`;

            // Change menu button to save/cancel buttons
            menuBtn.style.display = 'none';
            
            const actionButtons = document.createElement('div');
            actionButtons.innerHTML = `
              <button class="save-edit-btn">Save</button>
              <button class="cancel-edit-btn">Cancel</button>
            `;
            menuBtn.parentNode.appendChild(actionButtons);

            // Add save/cancel handlers
            actionButtons.querySelector('.save-edit-btn').onclick = async () => {
              const newTitle = row.querySelector('.edit-title').value;
              const newDescription = row.querySelector('.edit-description').value;
              
              try {
                const apiKey = await getApiKey();
                const response = await fetch(`${API_BASE_URL}/api/links/${linkId}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                  },
                  body: JSON.stringify({
                    ...link,
                    title: newTitle,
                    description: newDescription
                  })
                });

                if (!response.ok) throw new Error('Failed to update link');
                
                await loadSavedLinks();
                showMessage('Link updated successfully!');
              } catch (error) {
                showMessage(error.message, 'error');
                // Restore original content on error
                titleCell.textContent = row.dataset.originalTitle;
                descriptionCell.textContent = row.dataset.originalDescription;
              }
              
              // Restore menu button
              menuBtn.style.display = 'block';
              actionButtons.remove();
            };

            actionButtons.querySelector('.cancel-edit-btn').onclick = () => {
              titleCell.textContent = row.dataset.originalTitle;
              descriptionCell.textContent = row.dataset.originalDescription;
              menuBtn.style.display = 'block';
              actionButtons.remove();
            };
            break;
          }

          case 'delete':
            if (confirm('Are you sure you want to delete this link?')) {
              const apiKey = await getApiKey();
              const response = await fetch(`${API_BASE_URL}/api/links/${linkId}`, {
                method: 'DELETE',
                headers: {
                  'X-API-Key': apiKey
                }
              });

              if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Failed to delete link');
              }

              await loadSavedLinks();
              showMessage('Link deleted successfully!');
            }
            break;

          case 'view':
            showUrlOverlay(link.url);
            break;

          case 'copy':
            await navigator.clipboard.writeText(link.url);
            showMessage('URL copied to clipboard!');
            break;

          case 'open':
            chrome.tabs.create({ url: link.url });
            break;

          case 'notes':
            showNotesOverlay(link.notes);
            break;
        }
      } catch (error) {
        console.error('Error:', error);
        showMessage(error.message, 'error');
      }
    });
  }

  return row;
}

// Helper function to get API key
async function getApiKey() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['apiKey'], (result) => resolve(result.apiKey));
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
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function deleteSelectedLinks() {
  const selectedCheckboxes = document.querySelectorAll(
    '#savedLinksTable input[type="checkbox"]:checked'
  );
  const selectedIds = Array.from(selectedCheckboxes).map(
    (checkbox) => checkbox.dataset.linkId
  );

  if (selectedIds.length === 0) {
    showMessage("No links selected", "error");
    return;
  }

  if (confirm("Are you sure you want to delete the selected links?")) {
    Promise.all(
      selectedIds.map((id) =>
        new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "deleteLink", linkId: id },
            resolve
          );
        })
      )
    ).then(() => {
      loadSavedLinks();
      showMessage("Selected links deleted successfully!");
      toggleSelectMode(); // Exit select mode after deletion
    });
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

function updatePagination(totalLinks) {
  const totalPages = Math.ceil(totalLinks / LINKS_PER_PAGE);
  let paginationHtml = "";

  if (totalPages > 1) {
    paginationHtml += createPaginationButton(
      Math.max(1, currentPage - 1),
      "&laquo;"
    );
    for (let i = 1; i <= totalPages; i++) {
      paginationHtml += createPaginationButton(i, i, i === currentPage);
    }
    paginationHtml += createPaginationButton(
      Math.min(totalPages, currentPage + 1),
      "&raquo;"
    );
  }

  document.getElementById("pagination").innerHTML = paginationHtml;
}

function createPaginationButton(page, text, disabled = false) {
  return `<button onclick="changePage(${page})" ${
    disabled ? "disabled" : ""
  }>${text}</button>`;
}

function changePage(newPage) {
  const currentPage = newPage;
  loadSavedLinks();
}

function showMenu(button, linkId) {
  // If linkId is not passed directly, get it from the button's data attribute
  const targetLinkId = linkId || button.dataset.linkId;
  if (!targetLinkId) {
    console.error("No link ID found for menu");
    return;
  }

  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.innerHTML = `
    <div class="menu-item" data-action="edit" data-link-id="${targetLinkId}">Edit</div>
    <div class="menu-item" data-action="delete" data-link-id="${targetLinkId}">Delete</div>
    <div class="menu-item" data-action="viewURL" data-link-id="${targetLinkId}">View URL</div>
    <div class="menu-item" data-action="copyURL" data-link-id="${targetLinkId}">Copy URL</div>
    <div class="menu-item" data-action="openURL" data-link-id="${targetLinkId}">Open URL</div>
    <div class="menu-item" data-action="viewNotes" data-link-id="${targetLinkId}">View Notes</div>
  `;
  menu.style.position = "absolute";
  menu.style.left = `${button.offsetLeft}px`;
  menu.style.top = `${button.offsetTop + button.offsetHeight}px`;

  document.body.appendChild(menu);

  for (const item of menu.querySelectorAll(".menu-item")) {
    item.addEventListener("click", () => {
      const action = item.dataset.action;
      const itemLinkId = item.dataset.linkId;

      if (action === "edit") editRSSItem(itemLinkId);
      else if (action === "delete") {
        if (confirm("Are you sure you want to delete this link?")) {
          deleteLink(itemLinkId);
        }
      } else if (action === "viewURL") viewURL(itemLinkId);
      else if (action === "copyURL") copyLinkURL(itemLinkId);
      else if (action === "openURL") {
        chrome.storage.local.get({ savedLinks: [] }, (result) => {
          const link = result.savedLinks.find(l => l.id === itemLinkId);
          if (link) {
            chrome.tabs.create({ url: link.url });
          }
        });
      } else if (action === "viewNotes") viewNotes(itemLinkId);
      
      document.body.removeChild(menu);
    });
  }

  // Close menu when clicking outside
  document.addEventListener("click", function closeMenu(e) {
    if (!menu.contains(e.target) && e.target !== button) {
      document.body.removeChild(menu);
      document.removeEventListener("click", closeMenu);
    }
  });
}

function viewURL(linkId) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const link = result.savedLinks.find(l => l.id === linkId);
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
            const response = await fetch(`${LINK_EDIT_ENDPOINT}/${link.id}`, {
              method: "PUT",
              headers: {
                "Content-Type": "application/json",
                "X-API-Key": apiKey,
              },
              body: JSON.stringify(updatedLink),
            });

            if (!response.ok) {
              const errorData = await response.json();
              throw new Error(
                errorData.error || "Failed to update URL on server"
              );
            }

            // Get the updated link from the response
            const updatedLinkFromServer = await response.json();
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

// First instance - for copying by ID
function copyLinkURL(linkId) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const link = result.savedLinks.find(l => l.id === linkId);
    if (link) {
      navigator.clipboard.writeText(link.url).then(() => {
        showMessage("URL copied to clipboard!");
      });
    }
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

function viewNotes(linkId) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const link = result.savedLinks.find(l => l.id === linkId);
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
  });
}

function editRSSItem(linkId) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const link = result.savedLinks.find(l => l.id === linkId);
    if (!link) {
      console.error("Link not found for ID:", linkId);
      return;
    }

    // Find the row using a more reliable selector
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

    // Store original values and link ID
    row.dataset.originalTitle = titleCell.textContent;
    row.dataset.originalDescription = descriptionCell.textContent;
    row.dataset.linkId = linkId;

    // Replace content with editable fields
    titleCell.innerHTML = `<input type="text" class="edit-title" value="${escapeHtml(
      titleCell.textContent
    )}">`;
    descriptionCell.innerHTML = `<textarea class="edit-description">${escapeHtml(
      descriptionCell.textContent
    )}</textarea>`;

    // Change menu button to save button
    menuButton.textContent = "Save";
    menuButton.classList.add("save-btn");
    menuButton.classList.remove("menu-btn");

    // Add cancel button
    const cancelButton = document.createElement("button");
    cancelButton.textContent = "Cancel";
    cancelButton.classList.add("cancel-btn");
    cancelButton.onclick = () => {
      titleCell.textContent = row.dataset.originalTitle;
      descriptionCell.textContent = row.dataset.originalDescription;
      restoreMenuButton();
    };
    menuButton.parentNode.insertBefore(cancelButton, menuButton);

    // Update menu button click handler
    menuButton.onclick = () => {
      saveRSSItemChanges(linkId, row);
      restoreMenuButton();
    };

    function restoreMenuButton() {
      menuButton.textContent = "...";
      menuButton.classList.remove("save-btn");
      menuButton.classList.add("menu-btn");
      if (cancelButton.parentNode) {
        cancelButton.parentNode.removeChild(cancelButton);
      }
      menuButton.onclick = (event) => {
        showMenu(event.target, linkId);
      };
    }
  });
}

async function deleteLink(linkId) {
  try {
    // Get the link and API key
    const [currentLink, apiKey] = await Promise.all([
      new Promise((resolve) => {
        chrome.storage.local.get({ savedLinks: [] }, (result) => {
          resolve(result.savedLinks.find(l => l.id === linkId));
        });
      }),
      new Promise((resolve) => {
        chrome.storage.sync.get(["apiKey"], (result) => resolve(result.apiKey));
      }),
    ]);

    if (!currentLink) {
      throw new Error("Link not found");
    }

    if (apiKey && currentLink.id) {
      // Delete from API first
      const response = await fetch(
        `${LINK_DELETE_ENDPOINT}/${currentLink.id}`,
        {
          method: "DELETE",
          headers: {
            "X-API-Key": apiKey,
          },
        }
      );

      // Check for successful deletion (204) or not found (404)
      if (response.status !== 204 && response.status !== 404) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to delete link from server");
      }
    }

    // Delete from local storage
    chrome.storage.local.get({ savedLinks: [] }, (result) => {
      const savedLinks = result.savedLinks;
      savedLinks.splice(savedLinks.findIndex(l => l.id === linkId), 1);
      chrome.storage.local.set({ savedLinks }, () => {
        loadSavedLinks(); // Reload the list
        showMessage("Link deleted successfully!");
      });
    });
  } catch (error) {
    console.error("Error deleting link:", error);
    showMessage(error.message, "error");
  }
}

// Update the confirmDelete function to be async
async function confirmDelete(index) {
  if (confirm("Are you sure you want to delete this link?")) {
    await deleteLink(index);
  }
}

async function saveRSSItemChanges(linkId, row) {
  const newTitle = row.querySelector(".edit-title").value.trim();
  const newDescription = row.querySelector(".edit-description").value.trim();

  if (!newTitle) {
    showMessage("Title cannot be empty", "error");
    return;
  }

  try {
    const [savedLinks, apiKey] = await Promise.all([
      new Promise((resolve) => {
        chrome.storage.local.get({ savedLinks: [] }, (result) => {
          resolve(result.savedLinks);
        });
      }),
      new Promise((resolve) => {
        chrome.storage.sync.get(["apiKey"], (result) => resolve(result.apiKey));
      }),
    ]);

    const linkIndex = savedLinks.findIndex(l => l.id === linkId);
    if (linkIndex === -1) {
      throw new Error("Link not found");
    }

    const currentLink = savedLinks[linkIndex];

    // Prepare update data according to API spec
    const updatedLink = {
      url: currentLink.url,
      title: newTitle,
      description: newDescription || null,
      notes: currentLink.notes || null,
      tags: Array.isArray(currentLink.tags) ? currentLink.tags : [],
    };

    if (apiKey) {
      const response = await fetch(`${LINK_EDIT_ENDPOINT}/${linkId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(updatedLink),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update link on server");
      }

      // Get the updated link from the response and update local storage
      const updatedLinkFromServer = await response.json();
      savedLinks[linkIndex] = updatedLinkFromServer;
      chrome.storage.local.set({ savedLinks }, () => {
        loadSavedLinks();
        showMessage("Link updated successfully!");
      });
    }
  } catch (error) {
    console.error("Error updating link:", error);
    showMessage(error.message, "error");
  }
}

function editURL(index) {
  chrome.storage.local.get({ savedLinks: [] }, (result) => {
    const savedLinks = result.savedLinks;
    const link = savedLinks[index];
    const newUrl = prompt("Edit URL:", link.url);
    if (newUrl !== null && newUrl !== link.url) {
      link.url = newUrl;
      savedLinks[index] = link;
      chrome.storage.local.set({ savedLinks: savedLinks }, () => {
        loadSavedLinks();
        updateRSSFeed();
        document.getElementById("message").textContent =
          "URL updated successfully!";
      });
    }
  });
}

function addTag() {
  const tagInput = document.getElementById("tagInput");
  const tags = tagInput.value
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag);

  for (const tag of tags) {
    if (!selectedTags.has(tag)) {
      selectedTags.add(tag);
    }
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
document.addEventListener("DOMContentLoaded", () => {
  chrome.storage.sync.get(["apiKey"], (result) => {
    if (result.apiKey) {
      document.getElementById("apiKey").value = result.apiKey;
    }
  });
});

// Load RSS feed URL if API key exists
function loadRSSFeedURL() {
  chrome.storage.sync.get(["apiKey"], async (result) => {
    if (result.apiKey) {
      try {
        const response = await fetch(VALIDATE_ENDPOINT, {
          method: "GET",
          headers: {
            "X-API-Key": result.apiKey,
          },
        });

        if (response.ok) {
          const data = await response.json();
          const rssFeedUrl = document.getElementById("rssFeedUrl");
          document.getElementById("rssFeedSection").style.display = "block";
          rssFeedUrl.textContent = data.feedUrl;

          // Add click-to-copy functionality
          rssFeedUrl.style.cursor = "pointer";
          rssFeedUrl.addEventListener("click", async () => {
            try {
              await navigator.clipboard.writeText(data.feedUrl);
              const originalText = rssFeedUrl.textContent;
              rssFeedUrl.textContent = "Copied!";
              setTimeout(() => {
                rssFeedUrl.textContent = originalText;
              }, 1500);
            } catch (err) {
              console.error("Failed to copy:", err);
              showMessage("Failed to copy to clipboard", "error");
            }
          });

          hideAPIKeyEntry();
        } else {
          chrome.storage.sync.remove(["apiKey"]);
          document.getElementById("rssFeedSection").style.display = "none";
          document.getElementById("editApiKey").style.display = "none"; // Hide edit button on invalid API key
          showAPIKeyEntry();
        }
      } catch (error) {
        console.error("Error loading RSS feed URL:", error);
        document.getElementById("editApiKey").style.display = "none"; // Hide edit button on error
        showAPIKeyEntry();
      }
    } else {
      document.getElementById("editApiKey").style.display = "none"; // Hide edit button when no API key exists
      showAPIKeyEntry();
    }
  });
}

// Update RSS feed when links change
async function updateRSSFeed() {
  const apiKey = await new Promise((resolve) => {
    chrome.storage.sync.get(["apiKey"], (result) => resolve(result.apiKey));
  });

  if (!apiKey) return;

  try {
    const response = await fetch(`${API_BASE_URL}/refresh-feed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.error("Failed to update RSS feed");
    }
  } catch (error) {
    console.error("Error updating RSS feed:", error);
  }
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

  chrome.storage.sync.get(["apiKey"], (result) => {
    if (result.apiKey) {
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

// Update error handling in the submit handler
async function handleSubmit(event) {
  event.preventDefault();
  
  try {
    const linkData = {
      url: urlInput.value.trim(),
      title: titleInput.value.trim(),
      description: descriptionInput.value.trim() || null,
      notes: notesInput.value.trim() || null,
      tags: tagsInput.value ? tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : []
    };

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
    showSuccess(currentEditId ? 'Link updated successfully!' : 'Link saved successfully!');
    resetForm();
  } catch (error) {
    showError(error.message || 'Failed to save link');
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

  // Set values
  titleInput.value = link.title;
  descriptionInput.value = link.description || '';
  notesInput.value = link.notes || '';
  
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

function resetForm() {
  currentEditId = null;
  urlInput.value = '';
  titleInput.value = '';
  descriptionInput.value = '';
  notesInput.value = '';
  tagsInput.value = '';
  
  submitButton.textContent = 'Save Link';
  cancelEditButton.style.display = 'none';
}

// Add cancel edit handler
function handleCancelEdit() {
  resetForm();
}

// Initialize the popup
document.addEventListener('DOMContentLoaded', async () => {
  // ... existing initialization code ...
  
  cancelEditButton.addEventListener('click', handleCancelEdit);
  await loadSavedLinks(); // Load links when popup opens
});

// Add new functions to handle the premium tab
function showPremiumTab() {
  // Hide all other tabs
  for (const tab of document.querySelectorAll('.tab-content')) {
    tab.classList.remove('active-content');
  }
  
  // Show premium tab
  document.getElementById('premiumTab').classList.add('active-content');
}

// Add event listener for dismiss button
document.getElementById('dismissPremium').addEventListener('click', () => {
  document.getElementById('premiumTab').classList.remove('active-content');
  document.getElementById('saveTab').classList.add('active-content');
});
