// Authentication Module

import { api, APIError } from './api.js';
import { userHelpers, store } from './store.js';
import { router } from './router.js';

class Auth {
    constructor() {
        this.accessToken = null;
        this.refreshing = false;
    }

    // Store access token in memory only (not localStorage for security)
    setToken(token) {
        this.accessToken = token;
    }

    // Get current access token
    getToken() {
        return this.accessToken;
    }

    // Clear access token
    clearToken() {
        this.accessToken = null;
    }

    // Check if user is currently authenticated
    isAuthenticated() {
        return !!this.accessToken && !this.isTokenExpired();
    }

    // Check if token is expired (basic check - server will validate properly)
    isTokenExpired() {
        if (!this.accessToken) return true;
        
        try {
            // Decode JWT payload (basic check - not cryptographically verified)
            const payload = JSON.parse(atob(this.accessToken.split('.')[1]));
            const now = Date.now() / 1000;
            return payload.exp < now;
        } catch (error) {
            // If we can't decode the token, consider it expired
            return true;
        }
    }

    // Login with email and password
    async login(email, password) {
        try {
            const response = await api.post('/auth/login', {
                email,
                password
            });

            // Extract user data and token from response
            const { user, access_token: accessToken } = response;
            
            // Store token and user data
            this.setToken(accessToken);
            userHelpers.setUser(user);

            console.log('Login successful');
            return { success: true, user };
            
        } catch (error) {
            console.error('Login failed:', error);
            
            // Return user-friendly error message
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Register new user
    async register(email, password, displayName) {
        try {
            const response = await api.post('/auth/register', {
                email,
                password,
                display_name: displayName
            });

            // Extract user data and token from response
            const { user, access_token: accessToken } = response;
            
            // Store token and user data
            this.setToken(accessToken);
            userHelpers.setUser(user);

            console.log('Registration successful');
            return { success: true, user };
            
        } catch (error) {
            console.error('Registration failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Logout user
    async logout() {
        try {
            // Call logout endpoint to invalidate refresh token on server
            if (this.accessToken) {
                await api.post('/auth/logout');
            }
        } catch (error) {
            // Don't throw on logout errors - we want to clear local state anyway
            console.warn('Logout request failed:', error);
        } finally {
            // Always clear local state
            this.clearToken();
            userHelpers.clearUser();
            store.setState('portfolios', []);
            store.setState('activePortfolio', null);
            store.setState('watchlist', []);
            
            console.log('Logged out successfully');
            
            // Redirect to login page
            router.navigate('/login');
        }
    }

    // Refresh access token using httpOnly cookie
    async refreshToken() {
        if (this.refreshing) {
            // Wait for ongoing refresh to complete
            return new Promise((resolve) => {
                const checkRefresh = () => {
                    if (!this.refreshing) {
                        resolve(this.isAuthenticated());
                    } else {
                        setTimeout(checkRefresh, 100);
                    }
                };
                checkRefresh();
            });
        }

        this.refreshing = true;

        try {
            // The refresh token is stored as an httpOnly cookie
            // so it will be sent automatically with this request
            const response = await api.post('/auth/refresh');
            
            const { user, access_token: accessToken } = response;
            
            // Store new token and user data
            this.setToken(accessToken);
            userHelpers.setUser(user);
            
            console.log('Token refreshed successfully');
            return true;
            
        } catch (error) {
            console.warn('Token refresh failed:', error);
            
            // Clear any stale tokens
            this.clearToken();
            userHelpers.clearUser();
            
            return false;
        } finally {
            this.refreshing = false;
        }
    }

    // Change password
    async changePassword(currentPassword, newPassword) {
        try {
            await api.patch('/auth/password', {
                currentPassword,
                newPassword
            });

            return { success: true };
            
        } catch (error) {
            console.error('Password change failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Update user profile
    async updateProfile(updates) {
        try {
            const user = await api.patch('/auth/profile', updates);
            
            // Update user in store
            userHelpers.setUser(user);
            
            return { success: true, user };
            
        } catch (error) {
            console.error('Profile update failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Request password reset
    async requestPasswordReset(email) {
        try {
            await api.post('/auth/forgot-password', { email });
            
            return { success: true };
            
        } catch (error) {
            console.error('Password reset request failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Reset password with token
    async resetPassword(token, newPassword) {
        try {
            await api.post('/auth/reset-password', {
                token,
                newPassword
            });

            return { success: true };
            
        } catch (error) {
            console.error('Password reset failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Verify email address
    async verifyEmail(token) {
        try {
            const user = await api.post('/auth/verify-email', { token });
            
            // Update user in store
            userHelpers.setUser(user);
            
            return { success: true, user };
            
        } catch (error) {
            console.error('Email verification failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Resend verification email
    async resendVerificationEmail() {
        try {
            await api.post('/auth/resend-verification');
            
            return { success: true };
            
        } catch (error) {
            console.error('Resend verification failed:', error);
            
            return {
                success: false,
                error: this.getAuthErrorMessage(error)
            };
        }
    }

    // Get user-friendly error messages
    getAuthErrorMessage(error) {
        if (error instanceof APIError) {
            switch (error.code) {
                case 'INVALID_CREDENTIALS':
                    return 'Invalid email or password';
                case 'EMAIL_ALREADY_EXISTS':
                    return 'An account with this email already exists';
                case 'USER_NOT_FOUND':
                    return 'No account found with this email';
                case 'INVALID_TOKEN':
                    return 'Invalid or expired token';
                case 'WEAK_PASSWORD':
                    return 'Password is too weak';
                case 'INVALID_EMAIL':
                    return 'Please enter a valid email address';
                case 'EMAIL_NOT_VERIFIED':
                    return 'Please verify your email address before logging in';
                case 'ACCOUNT_SUSPENDED':
                    return 'Your account has been suspended';
                case 'TOO_MANY_ATTEMPTS':
                    return 'Too many login attempts. Please try again later';
                case 'NETWORK_ERROR':
                    return 'Network error. Please check your connection';
                default:
                    return error.getUserMessage();
            }
        }
        
        return 'An unexpected error occurred';
    }

    // Validate email format
    validateEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Validate password strength
    validatePassword(password) {
        const errors = [];
        
        if (password.length < 8) {
            errors.push('Password must be at least 8 characters long');
        }
        
        if (!/[a-z]/.test(password)) {
            errors.push('Password must contain at least one lowercase letter');
        }
        
        if (!/[A-Z]/.test(password)) {
            errors.push('Password must contain at least one uppercase letter');
        }
        
        if (!/\d/.test(password)) {
            errors.push('Password must contain at least one number');
        }
        
        if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
            errors.push('Password must contain at least one special character');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Validate display name
    validateDisplayName(displayName) {
        const errors = [];
        
        if (!displayName || displayName.trim().length < 2) {
            errors.push('Display name must be at least 2 characters long');
        }
        
        if (displayName && displayName.trim().length > 50) {
            errors.push('Display name must be less than 50 characters');
        }
        
        if (displayName && !/^[a-zA-Z0-9\s._-]+$/.test(displayName)) {
            errors.push('Display name can only contain letters, numbers, spaces, dots, hyphens, and underscores');
        }
        
        return {
            valid: errors.length === 0,
            errors
        };
    }

    // Get current user from store
    getCurrentUser() {
        return store.getState('user');
    }

    // Debug method to get auth state
    getDebugInfo() {
        return {
            hasToken: !!this.accessToken,
            isAuthenticated: this.isAuthenticated(),
            isExpired: this.isTokenExpired(),
            user: this.getCurrentUser(),
            refreshing: this.refreshing
        };
    }
}

// Create and export auth instance
export const auth = new Auth();

// Make auth available globally for debugging
if (typeof window !== 'undefined') {
    window.auth = auth;
}