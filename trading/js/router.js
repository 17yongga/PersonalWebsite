// Hash-based SPA Router

import { auth } from './auth.js';
import { store } from './store.js';

class Router {
    constructor() {
        this.routes = new Map();
        this.currentPage = null;
        this.initialized = false;
        this.appContainer = null;
    }

    init() {
        if (this.initialized) return;

        this.appContainer = document.getElementById('app');
        if (!this.appContainer) {
            throw new Error('App container element not found');
        }

        this.setupRoutes();
        this.bindEvents();
        this.initialized = true;
    }

    setupRoutes() {
        // Define routes with their lazy-loaded modules and metadata
        this.routes.set('/', {
            module: () => import('./pages/dashboard.js?v=1771481317'),
            requiresAuth: true,
            title: 'Dashboard'
        });

        this.routes.set('/login', {
            module: () => import('./pages/login.js?v=1771481317'),
            requiresAuth: false,
            title: 'Login'
        });

        this.routes.set('/trade/:symbol?', {
            module: () => import('./pages/trading.js?v=1771481317'),
            requiresAuth: true,
            title: 'Trade'
        });

        this.routes.set('/portfolio/:id', {
            module: () => import('./pages/portfolio.js?v=1771481317'),
            requiresAuth: true,
            title: 'Portfolio'
        });

        // Redirect deprecated routes to home
        this.routes.set('/strategies', {
            module: () => Promise.resolve({ default: () => ({ 
                render: () => { window.location.hash = '#/'; } 
            })}),
            requiresAuth: true,
            title: 'Dashboard'
        });

        this.routes.set('/contests', {
            module: () => Promise.resolve({ default: () => ({ 
                render: () => { window.location.hash = '#/'; } 
            })}),
            requiresAuth: true,
            title: 'Dashboard'
        });

        this.routes.set('/leaderboard', {
            module: () => Promise.resolve({ default: () => ({ 
                render: () => { window.location.hash = '#/'; } 
            })}),
            requiresAuth: true,
            title: 'Dashboard'
        });

        this.routes.set('/profile', {
            module: () => import('./pages/profile.js?v=1771481317'),
            requiresAuth: true,
            title: 'Profile'
        });

        // 404 fallback
        this.routes.set('*', {
            module: () => import('./pages/404.js?v=1771481317'),
            requiresAuth: false,
            title: 'Page Not Found'
        });
    }

    bindEvents() {
        // Listen for hash changes
        window.addEventListener('hashchange', () => this.handleRoute());
        
        // Handle initial route
        this.handleRoute();
    }

    async handleRoute() {
        try {
            const hash = window.location.hash.slice(1) || '/';
            const { route, params } = this.parseRoute(hash);
            const routeConfig = this.routes.get(route) || this.routes.get('*');

            // Store current route in state
            store.setState('currentRoute', { path: hash, route, params });

            // Check authentication
            if (routeConfig.requiresAuth && !auth.isAuthenticated()) {
                console.log('Route requires authentication, redirecting to login');
                this.navigate('/login');
                return;
            }

            // Redirect away from login if already authenticated
            if (route === '/login' && auth.isAuthenticated()) {
                console.log('Already authenticated, redirecting to dashboard');
                this.navigate('/');
                return;
            }

            // Update document title
            document.title = `${routeConfig.title} | Paper Trading | Gary Yong`;

            // Show loading state
            this.showLoadingState();

            // Destroy current page if exists
            await this.destroyCurrentPage();

            // Load and render new page
            await this.loadAndRenderPage(routeConfig, params);

        } catch (error) {
            console.error('Route handling error:', error);
            await this.handleRouteError(error);
        }
    }

    parseRoute(path) {
        // Find matching route pattern
        for (const [pattern] of this.routes) {
            if (pattern === '*') continue; // Skip wildcard for now

            const params = this.matchRoute(pattern, path);
            if (params !== null) {
                return { route: pattern, params };
            }
        }

        // No match found, return wildcard
        return { route: '*', params: {} };
    }

    matchRoute(pattern, path) {
        // Handle exact matches
        if (pattern === path) {
            return {};
        }

        // Handle parameterized routes
        const patternParts = pattern.split('/');
        const pathParts = path.split('/');

        if (patternParts.length !== pathParts.length) {
            return null;
        }

        const params = {};
        
        for (let i = 0; i < patternParts.length; i++) {
            const patternPart = patternParts[i];
            const pathPart = pathParts[i];

            if (patternPart.startsWith(':')) {
                // Parameter
                const paramName = patternPart.slice(1);
                const isOptional = paramName.endsWith('?');
                const cleanParamName = isOptional ? paramName.slice(0, -1) : paramName;

                if (!pathPart && !isOptional) {
                    return null; // Required parameter missing
                }

                if (pathPart) {
                    params[cleanParamName] = decodeURIComponent(pathPart);
                }
            } else if (patternPart !== pathPart) {
                // Literal part doesn't match
                return null;
            }
        }

        return params;
    }

    async destroyCurrentPage() {
        if (this.currentPage && this.currentPage.destroy) {
            try {
                await this.currentPage.destroy();
            } catch (error) {
                console.warn('Error destroying current page:', error);
            }
        }
        this.currentPage = null;
    }

    async loadAndRenderPage(routeConfig, params) {
        try {
            // Load page module
            const pageModule = await routeConfig.module();
            const exported = pageModule.default;

            // Support both factory functions (returns {render, destroy}) and plain objects
            const page = typeof exported === 'function' ? exported() : exported;

            // Validate page module
            if (!page || typeof page.render !== 'function') {
                throw new Error('Invalid page module: missing render function');
            }

            // Clear loading state
            this.clearLoadingState();

            // Render page
            await page.render(this.appContainer, params);

            // Store current page reference
            this.currentPage = page;

        } catch (error) {
            console.error('Error loading/rendering page:', error);
            throw error;
        }
    }

    showLoadingState() {
        this.appContainer.innerHTML = `
            <div class="route-loading">
                <div class="loading-content">
                    <div class="spinner spinner-lg"></div>
                    <p>Loading...</p>
                </div>
            </div>
        `;

        // Add some basic styling for the loading state
        const style = `
            .route-loading {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 50vh;
                padding: 2rem;
            }
            .loading-content {
                text-align: center;
                color: var(--text-secondary);
            }
            .loading-content .spinner {
                margin-bottom: 1rem;
            }
        `;

        if (!document.getElementById('router-loading-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'router-loading-styles';
            styleEl.textContent = style;
            document.head.appendChild(styleEl);
        }
    }

    clearLoadingState() {
        // Loading state will be cleared when new content is rendered
    }

    async handleRouteError(error) {
        console.error('Route error:', error);

        // Show error page
        this.appContainer.innerHTML = `
            <div class="route-error">
                <div class="error-content">
                    <div class="error-icon">
                        <i class="fas fa-exclamation-triangle"></i>
                    </div>
                    <h2>Something went wrong</h2>
                    <p>We're having trouble loading this page.</p>
                    <div class="error-actions">
                        <button class="btn btn-primary" onclick="window.location.reload()">
                            Reload Page
                        </button>
                        <button class="btn btn-secondary" onclick="window.location.hash = '#/'">
                            Go Home
                        </button>
                    </div>
                </div>
            </div>
        `;

        // Add error page styles
        const style = `
            .route-error {
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 60vh;
                padding: 2rem;
            }
            .error-content {
                text-align: center;
                max-width: 400px;
            }
            .error-icon {
                font-size: 4rem;
                color: var(--danger);
                margin-bottom: 1.5rem;
                opacity: 0.7;
            }
            .error-content h2 {
                color: var(--text-primary);
                margin-bottom: 1rem;
            }
            .error-content p {
                color: var(--text-secondary);
                margin-bottom: 2rem;
            }
            .error-actions {
                display: flex;
                gap: 1rem;
                justify-content: center;
                flex-wrap: wrap;
            }
        `;

        if (!document.getElementById('router-error-styles')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'router-error-styles';
            styleEl.textContent = style;
            document.head.appendChild(styleEl);
        }
    }

    // Navigation methods
    navigate(path) {
        if (path === window.location.hash.slice(1)) {
            // Same path, trigger re-render
            this.handleRoute();
        } else {
            window.location.hash = path;
        }
    }

    replace(path) {
        window.location.replace(`#${path}`);
    }

    back() {
        window.history.back();
    }

    forward() {
        window.history.forward();
    }

    // Get current route info
    getCurrentRoute() {
        return store.getState('currentRoute') || { path: '/', route: '/', params: {} };
    }

    // Check if a route is currently active
    isActive(path) {
        const current = this.getCurrentRoute();
        return current.path === path || current.route === path;
    }

    // Utility method to build parameterized routes
    buildRoute(pattern, params = {}) {
        let route = pattern;
        
        Object.entries(params).forEach(([key, value]) => {
            route = route.replace(`:${key}?`, value || '').replace(`:${key}`, value);
        });

        // Clean up any remaining optional parameters
        route = route.replace(/\/:[^\/]+\?/g, '');
        
        return route;
    }
}

// Create and export router instance
export const router = new Router();

// Add some global navigation helpers
window.navigateTo = (path) => router.navigate(path);
window.goBack = () => router.back();