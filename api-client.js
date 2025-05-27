export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const apiClient = {
  async getApiKey() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(['apiKey'], (result) => {
        resolve(result.apiKey || null);
      });
    });
  },

  async setApiKey(apiKey) {
    return new Promise((resolve) => {
      chrome.storage.sync.set({ apiKey }, resolve);
    });
  },

  async validateApiKey(apiKey) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/validate-api-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ apiKey })
    });

    if (!response.ok) {
      throw new ApiError('Invalid API key', response.status, 'INVALID_API_KEY');
    }

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Expected JSON response but got:', contentType);
      throw new ApiError('Invalid response format from server', response.status);
    }

    try {
      const data = await response.json();
      console.log('Validation response:', data);
      
      // Handle nested response structure
      if (data.success && data.data && typeof data.data.valid !== 'undefined') {
        return { valid: data.data.valid === true };
      }
      if (typeof data.valid !== 'undefined') {
        // Handle direct valid property
        return { valid: data.valid === true };
      }
      console.error('Unexpected response structure:', data);
      throw new ApiError('Invalid response structure from server', response.status);
    } catch (error) {
      console.error('Failed to parse JSON response:', error);
      throw new ApiError('Invalid JSON response from server', response.status);
    }
  },

  async getRssFeedUrl(apiKey) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/extension/rss-token`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      throw new ApiError('Failed to get RSS feed URL', response.status);
    }

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Expected JSON response but got:', contentType);
      throw new ApiError('Invalid response format from server', response.status);
    }

    try {
      const data = await response.json();
      console.log('RSS token response:', data);
      
      // Handle nested response structure
      let rssToken;
      if (data.success && data.data) {
        rssToken = data.data.rssToken;
      } else {
        rssToken = data.rssToken;
      }
      
      // Construct RSS feed URL from token
      return rssToken ? `${CONFIG.API_BASE_URL}/api/rss/${rssToken}` : null;
    } catch (error) {
      console.error('Failed to parse JSON response:', error);
      throw new ApiError('Invalid JSON response from server', response.status);
    }
  },

  async getLinks(apiKey, params = {}) {
    // Use the extension-specific endpoint
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/extension/links`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      throw new ApiError('Failed to load links', response.status);
    }

    // Check if response is JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      console.error('Expected JSON response but got:', contentType);
      throw new ApiError('Invalid response format from server', response.status);
    }

    try {
      const data = await response.json();
      console.log('Links response:', data);
      
      // Handle nested response structure
      if (data.success && data.data) {
        return data.data.links || data.data || [];
      }
      // Handle direct links array
      return data.links || [];
    } catch (error) {
      console.error('Failed to parse JSON response:', error);
      throw new ApiError('Invalid JSON response from server', response.status);
    }
  },

  async createLink(apiKey, linkData) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(linkData)
    });

    if (!response.ok) {
      const error = await response.json();
      if (response.status === 403 && error.code === 'LINK_LIMIT_REACHED') {
        throw new ApiError(error.message, response.status, 'LINK_LIMIT_REACHED');
      }
      throw new ApiError(error.message || 'Failed to save link', response.status);
    }

    return response.json();
  },

  async updateLink(apiKey, linkId, linkData) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/links/${linkId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify(linkData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new ApiError(error.message || 'Failed to update link', response.status);
    }

    return response.json();
  },

  async deleteLink(apiKey, linkId) {
    console.log('Deleting link:', linkId);
    
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/links/${linkId}`, {
      method: 'DELETE',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.error('Delete link error:', errorData);
      throw new ApiError(errorData.error || errorData.message || 'Failed to delete link', response.status);
    }

    const data = await response.json();
    console.log('Delete response:', data);
    
    // Handle nested response structure
    if (data.success !== undefined) {
      if (!data.success) {
        throw new ApiError(data.error || data.message || 'Failed to delete link', response.status);
      }
      return data.data || data;
    }
    
    return data;
  },

  async bulkDeleteLinks(apiKey, linkIds) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/links/batch`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ ids: linkIds })
    });

    if (!response.ok) {
      throw new ApiError('Failed to delete links', response.status);
    }

    return response.json();
  },

  async getUserInfo(apiKey) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/extension/user`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      throw new ApiError('Failed to get user info', response.status);
    }

    const data = await response.json();
    console.log('User info response:', data);
    
    // Handle nested response structure
    if (data.success && data.data) {
      return data.data;
    }
    return data;
  },

  async getUserTags(apiKey) {
    const response = await fetch(`${CONFIG.API_BASE_URL}/api/extension/tags`, {
      method: 'GET',
      headers: {
        'X-API-Key': apiKey
      }
    });

    if (!response.ok) {
      throw new ApiError('Failed to get user tags', response.status);
    }

    const data = await response.json();
    console.log('Tags response:', data);
    
    // Handle nested response structure
    if (data.success && data.data) {
      return data.data.tags || [];
    }
    return data.tags || [];
  }
};

// Import CONFIG from config.js
import { CONFIG } from './config.js'; 