// Main Application Entry Point

import { router } from './router.js';
import { store } from './store.js';
import { auth } from './auth.js';
import { navbar } from './components/navbar.js';

class App {
    constructor() {
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        try {
            // Initialize theme from localStorage
            this.initTheme();

            // Set up global error handler
            this.setupErrorHandling();

            // Try to restore authentication state
            await this.restoreAuthState();

            // Render navbar
            this.renderNavbar();

            // Initialize router
            this.initRouter();

            // Set up disclaimer bar
            this.setupDisclaimerBar();

            // Mark as initialized
            this.initialized = true;

            console.log('📈 PaperTrade app initialized successfully');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.handleError('Failed to initialize application', error);
        }
    }

    initTheme() {
        const savedTheme = localStorage.getItem('trading-theme') || 'dark';
        document.documentElement.setAttribute('data-theme', savedTheme);
        store.setState('theme', savedTheme);
    }

    setupErrorHandling() {
        // Global error handler for unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            console.error('Unhandled promise rejection:', event.reason);
            this.handleError('An unexpected error occurred', event.reason);
        });

        // Global error handler for uncaught exceptions
        window.addEventListener('error', (event) => {
            console.error('Uncaught error:', event.error);
            this.handleError('An unexpected error occurred', event.error);
        });
    }

    async restoreAuthState() {
        try {
            // Check if we have a refresh token (stored as httpOnly cookie)
            // If the user was previously logged in, try to refresh the access token
            const isLoggedIn = await auth.refreshToken();
            
            if (isLoggedIn) {
                console.log('Authentication state restored');
            } else {
                console.log('No previous authentication state found');
            }
        } catch (error) {
            console.warn('Failed to restore auth state:', error);
            // Don't throw here - just continue without authentication
        }
    }

    renderNavbar() {
        const navbarElement = document.getElementById('navbar');
        if (navbarElement) {
            navbar.render(navbarElement);
        }
    }

    initRouter() {
        router.init();
        
        // Handle initial route
        if (!window.location.hash) {
            // Default route based on auth state
            const isAuthenticated = auth.isAuthenticated();
            window.location.hash = isAuthenticated ? '#/' : '#/login';
        }
    }

    setupDisclaimerBar() {
        const disclaimerBar = document.getElementById('disclaimer-bar');
        const dismissButton = document.getElementById('disclaimer-dismiss');

        if (!disclaimerBar || !dismissButton) return;

        // Check if disclaimer was previously dismissed in this session
        const isDismissed = sessionStorage.getItem('disclaimer-dismissed') === 'true';
        
        if (!isDismissed) {
            // Show disclaimer after a short delay
            setTimeout(() => {
                disclaimerBar.classList.add('show');
            }, 1000);
        }

        // Handle dismiss button
        dismissButton.addEventListener('click', () => {
            disclaimerBar.classList.remove('show');
            sessionStorage.setItem('disclaimer-dismissed', 'true');
        });

        // Auto-hide on navigation (but will reappear on page refresh)
        store.subscribe('currentRoute', () => {
            if (disclaimerBar.classList.contains('show')) {
                disclaimerBar.classList.remove('show');
                // Don't set session storage here - let it reappear on navigation
            }
        });
    }

    handleError(message, error = null) {
        // Import toast dynamically to avoid circular dependencies
        import('./components/toast.js').then(({ toast }) => {
            toast.error(message);
        });

        // Log full error for debugging
        if (error) {
            console.error('App Error:', error);
        }
    }

    // Method to toggle theme
    toggleTheme() {
        const currentTheme = store.getState('theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('trading-theme', newTheme);
        store.setState('theme', newTheme);
    }

    // Method to get current app state for debugging
    getDebugInfo() {
        return {
            initialized: this.initialized,
            currentRoute: store.getState('currentRoute'),
            user: store.getState('user'),
            theme: store.getState('theme'),
            isAuthenticated: auth.isAuthenticated()
        };
    }
}

// Create global app instance
const app = new App();

// Initialize app when DOM is loaded
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => app.init());
} else {
    // DOM already loaded
    app.init();
}

// Export app instance for debugging in console
window.app = app;

// Make theme toggle available globally
window.toggleTheme = () => app.toggleTheme();

export { app };