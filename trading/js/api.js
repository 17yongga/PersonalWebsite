// API Client with Auto-refresh and Error Handling

import { auth } from './auth.js';

class APIClient {
    constructor() {
        this.baseURL = this.detectBaseURL();
        this.defaultHeaders = {
            'Content-Type': 'application/json',
        };
        this.isRefreshing = false;
        this.refreshPromise = null;
        this.pendingRequests = [];
    }

    detectBaseURL() {
        // Detect environment and set appropriate base URL
        const hostname = window.location.hostname;
        
        if (hostname === 'localhost' || hostname === '127.0.0.1') {
            return 'http://localhost:3002/api/v1';
        } else {
            return 'https://api.gary-yong.com/api/v1';
        }
    }

    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        
        // Prepare headers
        const headers = {
            ...this.defaultHeaders,
            ...options.headers,
        };

        // Add authorization header if we have a token
        const token = auth.getToken();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }

        // Prepare fetch options
        const fetchOptions = {
            ...options,
            headers,
        };

        // Handle request body
        if (options.body && typeof options.body === 'object') {
            fetchOptions.body = JSON.stringify(options.body);
        }

        try {
            const response = await fetch(url, fetchOptions);
            return await this.handleResponse(response, endpoint, fetchOptions);
        } catch (error) {
            console.error(`API request failed for ${endpoint}:`, error);
            throw new APIError('Network error occurred', 'NETWORK_ERROR', null, error);
        }
    }

    async handleResponse(response, originalEndpoint, originalOptions) {
        // Handle 401 Unauthorized - try to refresh token
        if (response.status === 401 && !originalEndpoint.includes('/auth/')) {
            return await this.handleUnauthorized(response, originalEndpoint, originalOptions);
        }

        // Parse response body
        let data;
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
            try {
                data = await response.json();
            } catch (parseError) {
                throw new APIError(
                    'Failed to parse response',
                    'PARSE_ERROR',
                    response.status,
                    parseError
                );
            }
        } else {
            data = await response.text();
        }

        // Handle error responses
        if (!response.ok) {
            const errorMessage = data?.message || data?.error || `HTTP ${response.status}`;
            const errorCode = data?.code || `HTTP_${response.status}`;
            
            throw new APIError(errorMessage, errorCode, response.status, data);
        }

        // Return the data property for successful responses, or the raw data
        return data?.data !== undefined ? data.data : data;
    }

    async handleUnauthorized(response, originalEndpoint, originalOptions) {
        // If we're already refreshing, wait for it to complete
        if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
                this.pendingRequests.push({ resolve, reject, endpoint: originalEndpoint, options: originalOptions });
            });
        }

        // Start refresh process
        this.isRefreshing = true;
        
        try {
            const refreshSuccessful = await auth.refreshToken();
            
            if (refreshSuccessful) {
                // Retry original request with new token
                const newHeaders = {
                    ...originalOptions.headers,
                    Authorization: `Bearer ${auth.getToken()}`,
                };
                
                const retryOptions = {
                    ...originalOptions,
                    headers: newHeaders,
                };

                const retryResponse = await fetch(`${this.baseURL}${originalEndpoint}`, retryOptions);
                const result = await this.handleResponse(retryResponse, originalEndpoint, retryOptions);

                // Resolve pending requests
                this.resolvePendingRequests(null, result);
                
                return result;
            } else {
                // Refresh failed, user needs to login again
                auth.logout();
                const error = new APIError('Authentication expired', 'AUTH_EXPIRED', 401);
                this.resolvePendingRequests(error);
                throw error;
            }
        } catch (error) {
            // Refresh failed
            auth.logout();
            const authError = new APIError('Authentication failed', 'AUTH_FAILED', 401, error);
            this.resolvePendingRequests(authError);
            throw authError;
        } finally {
            this.isRefreshing = false;
            this.refreshPromise = null;
        }
    }

    resolvePendingRequests(error, result = null) {
        this.pendingRequests.forEach(({ resolve, reject, endpoint, options }) => {
            if (error) {
                reject(error);
            } else {
                // Retry the request
                this.request(endpoint, options).then(resolve).catch(reject);
            }
        });
        this.pendingRequests = [];
    }

    // Convenience methods

    async get(endpoint, params = {}) {
        const searchParams = new URLSearchParams();
        Object.entries(params).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
                searchParams.append(key, String(value));
            }
        });

        const queryString = searchParams.toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;

        return this.request(url, { method: 'GET' });
    }

    async post(endpoint, body = null) {
        return this.request(endpoint, {
            method: 'POST',
            body: body,
        });
    }

    async patch(endpoint, body = null) {
        return this.request(endpoint, {
            method: 'PATCH',
            body: body,
        });
    }

    async put(endpoint, body = null) {
        return this.request(endpoint, {
            method: 'PUT',
            body: body,
        });
    }

    async delete(endpoint) {
        return this.request(endpoint, {
            method: 'DELETE',
        });
    }

    // File upload method
    async uploadFile(endpoint, file, additionalFields = {}) {
        const formData = new FormData();
        formData.append('file', file);
        
        Object.entries(additionalFields).forEach(([key, value]) => {
            formData.append(key, value);
        });

        return this.request(endpoint, {
            method: 'POST',
            body: formData,
            headers: {
                // Don't set Content-Type, let browser set it with boundary for FormData
            },
        });
    }

    // Set custom header for all requests
    setHeader(name, value) {
        if (value === null || value === undefined) {
            delete this.defaultHeaders[name];
        } else {
            this.defaultHeaders[name] = value;
        }
    }

    // Get current base URL
    getBaseURL() {
        return this.baseURL;
    }

    // Set base URL (for testing or different environments)
    setBaseURL(url) {
        this.baseURL = url.replace(/\/$/, ''); // Remove trailing slash
    }
}

// Custom error class for API errors
class APIError extends Error {
    constructor(message, code = 'UNKNOWN_ERROR', status = null, details = null) {
        super(message);
        this.name = 'APIError';
        this.code = code;
        this.status = status;
        this.details = details;
    }

    // Check if error is of a specific type
    is(code) {
        return this.code === code;
    }

    // Check if error is a network error
    isNetworkError() {
        return this.code === 'NETWORK_ERROR';
    }

    // Check if error is an authentication error
    isAuthError() {
        return this.code === 'AUTH_EXPIRED' || this.code === 'AUTH_FAILED' || this.status === 401;
    }

    // Check if error is a validation error
    isValidationError() {
        return this.status === 400 || this.code === 'VALIDATION_ERROR';
    }

    // Check if error is a server error
    isServerError() {
        return this.status >= 500;
    }

    // Get a user-friendly error message
    getUserMessage() {
        switch (this.code) {
            case 'NETWORK_ERROR':
                return 'Unable to connect to the server. Please check your internet connection.';
            case 'AUTH_EXPIRED':
                return 'Your session has expired. Please log in again.';
            case 'AUTH_FAILED':
                return 'Authentication failed. Please log in again.';
            case 'VALIDATION_ERROR':
                return this.message || 'Please check your input and try again.';
            default:
                if (this.isServerError()) {
                    return 'A server error occurred. Please try again later.';
                }
                return this.message || 'An unexpected error occurred.';
        }
    }
}

// Create and export API client instance
export const api = new APIClient();
export { APIError };

// Make API client available globally for debugging
if (typeof window !== 'undefined') {
    window.api = api;
}