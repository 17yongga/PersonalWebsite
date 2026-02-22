// Navigation Bar Component

import { auth } from '../auth.js';
import { store, themeHelpers } from '../store.js';
import { router } from '../router.js';

class Navbar {
    constructor() {
        this.container = null;
        this.mobileMenuOpen = false;
        this.unsubscribers = [];
    }

    render(container) {
        this.container = container;
        this.bindStoreSubscriptions();
        this.updateNavbar();
    }

    bindStoreSubscriptions() {
        // Clear existing subscriptions
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];

        // Subscribe to auth state changes
        this.unsubscribers.push(
            store.subscribe('isAuthenticated', () => this.updateNavbar())
        );

        // Subscribe to user changes
        this.unsubscribers.push(
            store.subscribe('user', () => this.updateNavbar())
        );

        // Subscribe to route changes to update active nav items
        this.unsubscribers.push(
            store.subscribe('currentRoute', () => this.updateActiveNavItems())
        );

        // Subscribe to theme changes
        this.unsubscribers.push(
            store.subscribe('theme', () => this.updateThemeToggle())
        );
    }

    updateNavbar() {
        if (!this.container) return;

        const isAuthenticated = store.getState('isAuthenticated');
        const user = store.getState('user');
        const theme = store.getState('theme');

        this.container.innerHTML = `
            <nav class="navbar">
                <div class="navbar-container">
                    <!-- Brand/Logo -->
                    <div class="navbar-brand">
                        <a href="#/" class="brand-link">
                            <span class="brand-icon">📈</span>
                            <span class="brand-text">PaperTrade</span>
                        </a>
                    </div>

                    <!-- Desktop Navigation -->
                    <div class="navbar-nav desktop-nav" id="desktop-nav">
                        ${this.renderNavLinks(isAuthenticated)}
                    </div>

                    <!-- Right Side Actions -->
                    <div class="navbar-actions">
                        ${this.renderThemeToggle(theme)}
                        ${this.renderUserMenu(isAuthenticated, user)}
                        ${this.renderMobileMenuButton()}
                    </div>
                </div>

                <!-- Mobile Navigation -->
                <div class="navbar-mobile ${this.mobileMenuOpen ? 'open' : ''}" id="mobile-nav">
                    <div class="mobile-nav-content">
                        ${this.renderMobileNavLinks(isAuthenticated)}
                        ${this.renderMobileUserActions(isAuthenticated, user)}
                    </div>
                </div>
            </nav>
        `;

        this.bindEventListeners();
        this.updateActiveNavItems();
    }

    renderNavLinks(isAuthenticated) {
        if (!isAuthenticated) {
            return `
                <a href="#/login" class="nav-link" data-route="/login">Login</a>
            `;
        }

        return `
            <a href="#/" class="nav-link" data-route="/">
                <i class="fas fa-tachometer-alt"></i>
                Dashboard
            </a>
            <a href="#/trade" class="nav-link" data-route="/trade">
                <i class="fas fa-chart-line"></i>
                Trade
            </a>
        `;
    }

    renderMobileNavLinks(isAuthenticated) {
        if (!isAuthenticated) {
            return `
                <a href="#/login" class="mobile-nav-link" data-route="/login">
                    <i class="fas fa-sign-in-alt"></i>
                    Login
                </a>
            `;
        }

        return `
            <a href="#/" class="mobile-nav-link" data-route="/">
                <i class="fas fa-tachometer-alt"></i>
                Dashboard
            </a>
            <a href="#/trade" class="mobile-nav-link" data-route="/trade">
                <i class="fas fa-chart-line"></i>
                Trade
            </a>
        `;
    }

    renderThemeToggle(theme) {
        const icon = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        const title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

        return `
            <button class="theme-toggle" id="theme-toggle" title="${title}">
                <i class="${icon}"></i>
            </button>
        `;
    }

    renderUserMenu(isAuthenticated, user) {
        if (!isAuthenticated) {
            return `
                <a href="#/login" class="btn btn-primary btn-sm">Get Started</a>
            `;
        }

        const displayName = user?.display_name || 'User';
        const initials = this.getInitials(displayName);

        return `
            <div class="user-menu">
                <button class="user-menu-trigger" id="user-menu-trigger">
                    <div class="user-avatar">
                        <span class="user-initials">${initials}</span>
                    </div>
                    <span class="user-name">${displayName}</span>
                    <i class="fas fa-chevron-down user-menu-icon"></i>
                </button>
                
                <div class="user-menu-dropdown" id="user-menu-dropdown">
                    <div class="user-menu-header">
                        <div class="user-avatar">
                            <span class="user-initials">${initials}</span>
                        </div>
                        <div class="user-info">
                            <div class="user-name">${displayName}</div>
                            <div class="user-email">${user?.email || ''}</div>
                        </div>
                    </div>
                    
                    <div class="user-menu-divider"></div>
                    
                    <a href="#/profile" class="user-menu-item">
                        <i class="fas fa-user"></i>
                        Profile
                    </a>
                    
                    <div class="user-menu-divider"></div>
                    
                    <button class="user-menu-item logout-btn" id="logout-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        Logout
                    </button>
                </div>
            </div>
        `;
    }

    renderMobileUserActions(isAuthenticated, user) {
        if (!isAuthenticated) {
            return `
                <div class="mobile-auth-actions">
                    <a href="#/login" class="btn btn-primary w-full mb-2">Login</a>
                    <a href="#/login" class="btn btn-outline w-full">Sign Up</a>
                </div>
            `;
        }

        const displayName = user?.display_name || 'User';
        const initials = this.getInitials(displayName);

        return `
            <div class="mobile-user-section">
                <div class="mobile-user-header">
                    <div class="user-avatar">
                        <span class="user-initials">${initials}</span>
                    </div>
                    <div class="user-info">
                        <div class="user-name">${displayName}</div>
                        <div class="user-email">${user?.email || ''}</div>
                    </div>
                </div>
                
                <div class="mobile-user-actions">
                    <a href="#/profile" class="mobile-nav-link">
                        <i class="fas fa-user"></i>
                        Profile
                    </a>
                    <button class="mobile-nav-link logout-btn" id="mobile-logout-btn">
                        <i class="fas fa-sign-out-alt"></i>
                        Logout
                    </button>
                </div>
            </div>
        `;
    }

    renderMobileMenuButton() {
        return `
            <button class="mobile-menu-toggle ${this.mobileMenuOpen ? 'open' : ''}" id="mobile-menu-toggle">
                <span class="menu-bar"></span>
                <span class="menu-bar"></span>
                <span class="menu-bar"></span>
            </button>
        `;
    }

    bindEventListeners() {
        // Theme toggle
        const themeToggle = document.getElementById('theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', () => {
                const newTheme = themeHelpers.toggleTheme();
                document.documentElement.setAttribute('data-theme', newTheme);
                localStorage.setItem('trading-theme', newTheme);
            });
        }

        // User menu toggle
        const userMenuTrigger = document.getElementById('user-menu-trigger');
        const userMenuDropdown = document.getElementById('user-menu-dropdown');
        
        if (userMenuTrigger && userMenuDropdown) {
            userMenuTrigger.addEventListener('click', (e) => {
                e.stopPropagation();
                userMenuDropdown.classList.toggle('open');
            });

            // Close user menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!userMenuTrigger.contains(e.target) && !userMenuDropdown.contains(e.target)) {
                    userMenuDropdown.classList.remove('open');
                }
            });
        }

        // Mobile menu toggle
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        if (mobileMenuToggle) {
            mobileMenuToggle.addEventListener('click', () => {
                this.toggleMobileMenu();
            });
        }

        // Logout buttons
        const logoutButtons = document.querySelectorAll('.logout-btn');
        logoutButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleLogout();
            });
        });

        // Close mobile menu when clicking nav links
        const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
        mobileNavLinks.forEach(link => {
            link.addEventListener('click', () => {
                this.closeMobileMenu();
            });
        });

        // Close mobile menu when clicking outside
        document.addEventListener('click', (e) => {
            const mobileNav = document.getElementById('mobile-nav');
            const mobileMenuButton = document.getElementById('mobile-menu-toggle');
            
            if (this.mobileMenuOpen && 
                !mobileNav?.contains(e.target) && 
                !mobileMenuButton?.contains(e.target)) {
                this.closeMobileMenu();
            }
        });
    }

    updateActiveNavItems() {
        const currentRoute = store.getState('currentRoute');
        if (!currentRoute) return;

        // Update desktop nav links
        const desktopNavLinks = document.querySelectorAll('.nav-link');
        desktopNavLinks.forEach(link => {
            const route = link.getAttribute('data-route');
            if (route === currentRoute.route) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });

        // Update mobile nav links
        const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
        mobileNavLinks.forEach(link => {
            const route = link.getAttribute('data-route');
            if (route === currentRoute.route) {
                link.classList.add('active');
            } else {
                link.classList.remove('active');
            }
        });
    }

    updateThemeToggle() {
        const theme = store.getState('theme');
        const themeToggle = document.getElementById('theme-toggle');
        
        if (themeToggle) {
            const icon = themeToggle.querySelector('i');
            const title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
            
            icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
            themeToggle.setAttribute('title', title);
        }
    }

    toggleMobileMenu() {
        this.mobileMenuOpen = !this.mobileMenuOpen;
        
        const mobileNav = document.getElementById('mobile-nav');
        const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
        
        if (mobileNav) {
            mobileNav.classList.toggle('open', this.mobileMenuOpen);
        }
        
        if (mobileMenuToggle) {
            mobileMenuToggle.classList.toggle('open', this.mobileMenuOpen);
        }

        // Prevent body scrolling when mobile menu is open
        document.body.style.overflow = this.mobileMenuOpen ? 'hidden' : '';
    }

    closeMobileMenu() {
        if (this.mobileMenuOpen) {
            this.mobileMenuOpen = false;
            
            const mobileNav = document.getElementById('mobile-nav');
            const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
            
            if (mobileNav) {
                mobileNav.classList.remove('open');
            }
            
            if (mobileMenuToggle) {
                mobileMenuToggle.classList.remove('open');
            }

            // Restore body scrolling
            document.body.style.overflow = '';
        }
    }

    async handleLogout() {
        try {
            // Close any open menus
            this.closeMobileMenu();
            
            const userMenuDropdown = document.getElementById('user-menu-dropdown');
            if (userMenuDropdown) {
                userMenuDropdown.classList.remove('open');
            }

            // Perform logout
            await auth.logout();
        } catch (error) {
            console.error('Logout error:', error);
            // Still redirect to login on error
            router.navigate('/login');
        }
    }

    getInitials(name) {
        if (!name) return 'U';
        
        return name
            .split(' ')
            .map(part => part.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    destroy() {
        // Clean up event listeners and subscriptions
        this.unsubscribers.forEach(unsub => unsub());
        this.unsubscribers = [];
        
        // Restore body scrolling if mobile menu was open
        document.body.style.overflow = '';
    }
}

// Create and export navbar instance
export const navbar = new Navbar();

// Add navbar styles
const navbarStyles = `
    .navbar {
        background: var(--navbar-bg);
        border-bottom: 1px solid var(--border);
        position: sticky;
        top: 0;
        z-index: var(--z-sticky);
        backdrop-filter: blur(10px);
    }

    .navbar-container {
        max-width: var(--max-width-2xl);
        margin: 0 auto;
        padding: 0 var(--space-4);
        display: flex;
        align-items: center;
        justify-content: space-between;
        height: 64px;
    }

    .navbar-brand .brand-link {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        font-size: 1.25rem;
        font-weight: 700;
        color: var(--text-primary);
        text-decoration: none;
    }

    .brand-icon {
        font-size: 1.5rem;
    }

    .desktop-nav {
        display: flex;
        align-items: center;
        gap: var(--space-6);
    }

    .nav-link {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        padding: var(--space-2) var(--space-3);
        color: var(--text-secondary);
        text-decoration: none;
        border-radius: var(--radius-md);
        font-weight: 500;
        transition: all var(--transition-fast);
    }

    .nav-link:hover {
        color: var(--text-primary);
        background: rgba(255, 255, 255, 0.1);
    }

    .nav-link.active {
        color: var(--accent);
        background: rgba(59, 130, 246, 0.1);
    }

    .navbar-actions {
        display: flex;
        align-items: center;
        gap: var(--space-3);
    }

    .theme-toggle {
        background: none;
        border: none;
        color: var(--text-secondary);
        font-size: 1.25rem;
        padding: var(--space-2);
        border-radius: var(--radius-md);
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .theme-toggle:hover {
        color: var(--text-primary);
        background: rgba(255, 255, 255, 0.1);
    }

    .user-menu {
        position: relative;
    }

    .user-menu-trigger {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        background: none;
        border: none;
        padding: var(--space-2);
        border-radius: var(--radius-md);
        cursor: pointer;
        color: var(--text-primary);
        transition: all var(--transition-fast);
    }

    .user-menu-trigger:hover {
        background: rgba(255, 255, 255, 0.1);
    }

    .user-avatar {
        width: 32px;
        height: 32px;
        border-radius: var(--radius-full);
        background: var(--accent);
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-weight: 600;
        font-size: 0.875rem;
    }

    .user-name {
        font-weight: 500;
        max-width: 120px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .user-menu-icon {
        font-size: 0.75rem;
        transition: transform var(--transition-fast);
    }

    .user-menu-trigger:hover .user-menu-icon {
        transform: translateY(1px);
    }

    .user-menu-dropdown {
        position: absolute;
        top: 100%;
        right: 0;
        min-width: 200px;
        background: var(--card-bg);
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        box-shadow: var(--shadow-lg);
        padding: var(--space-4);
        margin-top: var(--space-2);
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: all var(--transition-fast);
    }

    .user-menu-dropdown.open {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .user-menu-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-3);
    }

    .user-menu-header .user-info {
        flex: 1;
        min-width: 0;
    }

    .user-menu-header .user-name {
        font-weight: 600;
        color: var(--text-primary);
        max-width: none;
    }

    .user-email {
        font-size: 0.75rem;
        color: var(--text-secondary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .user-menu-divider {
        height: 1px;
        background: var(--border);
        margin: var(--space-3) 0;
    }

    .user-menu-item {
        display: flex;
        align-items: center;
        gap: var(--space-2);
        width: 100%;
        padding: var(--space-2) var(--space-1);
        background: none;
        border: none;
        color: var(--text-secondary);
        text-decoration: none;
        font-size: 0.875rem;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all var(--transition-fast);
    }

    .user-menu-item:hover {
        color: var(--text-primary);
        background: var(--bg-secondary);
    }

    .mobile-menu-toggle {
        display: none;
        flex-direction: column;
        justify-content: space-between;
        width: 24px;
        height: 18px;
        background: none;
        border: none;
        cursor: pointer;
        padding: 0;
    }

    .menu-bar {
        width: 100%;
        height: 2px;
        background: var(--text-primary);
        border-radius: 1px;
        transition: all var(--transition-fast);
    }

    .mobile-menu-toggle.open .menu-bar:nth-child(1) {
        transform: rotate(45deg) translate(5px, 5px);
    }

    .mobile-menu-toggle.open .menu-bar:nth-child(2) {
        opacity: 0;
    }

    .mobile-menu-toggle.open .menu-bar:nth-child(3) {
        transform: rotate(-45deg) translate(7px, -6px);
    }

    .navbar-mobile {
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: var(--card-bg);
        border-bottom: 1px solid var(--border);
        max-height: 0;
        overflow: hidden;
        transition: max-height var(--transition-medium);
    }

    .navbar-mobile.open {
        max-height: 100vh;
    }

    .mobile-nav-content {
        padding: var(--space-4);
    }

    .mobile-nav-link {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        color: var(--text-secondary);
        text-decoration: none;
        border-radius: var(--radius-md);
        margin-bottom: var(--space-2);
        transition: all var(--transition-fast);
    }

    .mobile-nav-link:hover,
    .mobile-nav-link.active {
        color: var(--accent);
        background: rgba(59, 130, 246, 0.1);
    }

    .mobile-user-section {
        margin-top: var(--space-4);
        padding-top: var(--space-4);
        border-top: 1px solid var(--border);
    }

    .mobile-user-header {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        margin-bottom: var(--space-4);
    }

    .mobile-user-actions {
        display: flex;
        flex-direction: column;
        gap: var(--space-2);
    }

    .mobile-auth-actions {
        margin-top: var(--space-4);
        padding-top: var(--space-4);
        border-top: 1px solid var(--border);
    }

    @media (max-width: 768px) {
        .desktop-nav {
            display: none;
        }

        .mobile-menu-toggle {
            display: flex;
        }

        .user-name {
            display: none;
        }

        .navbar-container {
            padding: 0 var(--space-3);
        }
    }

    @media (max-width: 480px) {
        .brand-text {
            display: none;
        }
    }
`;

// Inject navbar styles
if (!document.getElementById('navbar-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'navbar-styles';
    styleEl.textContent = navbarStyles;
    document.head.appendChild(styleEl);
}