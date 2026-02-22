// Utility Functions

// Currency formatting
export function formatCurrency(amount, currency = 'USD', decimals = 2) {
    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: currency,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(amount);
    } catch (error) {
        // Fallback for unsupported currencies or environments
        return `$${formatNumber(amount, decimals)}`;
    }
}

// Percentage formatting with color class
export function formatPercent(value, decimals = 2, includeClass = true) {
    const formatted = (value >= 0 ? '+' : '') + value.toFixed(decimals) + '%';
    
    if (!includeClass) {
        return formatted;
    }
    
    let className = 'neutral';
    if (value > 0) className = 'positive';
    else if (value < 0) className = 'negative';
    
    return {
        text: formatted,
        className: className
    };
}

// Number formatting with commas
export function formatNumber(value, decimals = 0) {
    try {
        return new Intl.NumberFormat('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals,
        }).format(value);
    } catch (error) {
        // Fallback
        return value.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
}

// Large number formatting (1.2K, 1.5M, etc.)
export function formatLargeNumber(value, decimals = 1) {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    
    if (abs < 1000) {
        return sign + abs.toString();
    } else if (abs < 1000000) {
        return sign + (abs / 1000).toFixed(decimals) + 'K';
    } else if (abs < 1000000000) {
        return sign + (abs / 1000000).toFixed(decimals) + 'M';
    } else {
        return sign + (abs / 1000000000).toFixed(decimals) + 'B';
    }
}

// Date formatting
export function formatDate(dateInput, format = 'short') {
    const date = new Date(dateInput);
    
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    
    const now = new Date();
    const diffInMs = now - date;
    const diffInHours = diffInMs / (1000 * 60 * 60);
    const diffInDays = diffInMs / (1000 * 60 * 60 * 24);
    
    // Recent dates get special formatting
    if (format === 'relative') {
        if (diffInMs < 60000) { // Less than 1 minute
            return 'just now';
        } else if (diffInMs < 3600000) { // Less than 1 hour
            const minutes = Math.floor(diffInMs / 60000);
            return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
        } else if (diffInHours < 24) {
            const hours = Math.floor(diffInHours);
            return `${hours} hour${hours === 1 ? '' : 's'} ago`;
        } else if (diffInDays < 7) {
            const days = Math.floor(diffInDays);
            return `${days} day${days === 1 ? '' : 's'} ago`;
        }
    }
    
    // Standard formatting
    const options = {
        short: { month: 'short', day: 'numeric', year: 'numeric' },
        long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
        compact: { month: 'numeric', day: 'numeric', year: '2-digit' },
        time: { hour: 'numeric', minute: '2-digit' }
    };
    
    try {
        return date.toLocaleDateString('en-US', options[format] || options.short);
    } catch (error) {
        // Fallback
        return date.toDateString();
    }
}

// Time formatting
export function formatTime(dateInput, format = '12hour') {
    const date = new Date(dateInput);
    
    if (isNaN(date.getTime())) {
        return 'Invalid Time';
    }
    
    try {
        const options = {
            '12hour': { hour: 'numeric', minute: '2-digit', hour12: true },
            '24hour': { hour: '2-digit', minute: '2-digit', hour12: false },
            'seconds': { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }
        };
        
        return date.toLocaleTimeString('en-US', options[format] || options['12hour']);
    } catch (error) {
        // Fallback
        return date.toTimeString().slice(0, 8);
    }
}

// DateTime formatting
export function formatDateTime(dateInput, format = 'short') {
    const date = new Date(dateInput);
    
    if (isNaN(date.getTime())) {
        return 'Invalid Date';
    }
    
    const dateStr = formatDate(date, format);
    const timeStr = formatTime(date);
    
    return `${dateStr} at ${timeStr}`;
}

// Debounce function
export function debounce(func, wait, immediate = false) {
    let timeout;
    
    return function executedFunction(...args) {
        const later = () => {
            timeout = null;
            if (!immediate) func.apply(this, args);
        };
        
        const callNow = immediate && !timeout;
        
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        
        if (callNow) func.apply(this, args);
    };
}

// Throttle function
export function throttle(func, limit) {
    let inThrottle;
    
    return function executedFunction(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// HTML escaping for XSS prevention
export function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Generate unique ID
export function generateId() {
    try {
        return crypto.randomUUID();
    } catch (error) {
        // Fallback for environments without crypto.randomUUID
        return 'id-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now().toString(36);
    }
}

// Deep clone object
export function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    
    if (obj instanceof Date) {
        return new Date(obj.getTime());
    }
    
    if (obj instanceof Array) {
        return obj.map(item => deepClone(item));
    }
    
    if (typeof obj === 'object') {
        const copy = {};
        Object.keys(obj).forEach(key => {
            copy[key] = deepClone(obj[key]);
        });
        return copy;
    }
    
    return obj;
}

// Check if objects are equal (shallow comparison)
export function isEqual(a, b) {
    if (a === b) return true;
    
    if (a == null || b == null) return false;
    
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }
    
    if (typeof a === 'object' && typeof b === 'object') {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);
        
        if (keysA.length !== keysB.length) return false;
        
        for (const key of keysA) {
            if (!keysB.includes(key) || a[key] !== b[key]) return false;
        }
        
        return true;
    }
    
    return false;
}

// Clamp number between min and max
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

// Calculate percentage change
export function calculatePercentChange(oldValue, newValue) {
    if (oldValue === 0) {
        return newValue === 0 ? 0 : 100;
    }
    return ((newValue - oldValue) / Math.abs(oldValue)) * 100;
}

// Format market cap
export function formatMarketCap(value) {
    return formatLargeNumber(value, 1);
}

// Format volume
export function formatVolume(value) {
    return formatLargeNumber(value, 1);
}

// Get color for price change
export function getPriceChangeColor(change) {
    if (change > 0) return 'var(--success)';
    if (change < 0) return 'var(--danger)';
    return 'var(--text-secondary)';
}

// Sleep function
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Check if value is numeric
export function isNumeric(value) {
    return !isNaN(parseFloat(value)) && isFinite(value);
}

// Format file size
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Capitalize first letter
export function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

// Convert snake_case to camelCase
export function toCamelCase(str) {
    return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
}

// Convert camelCase to snake_case
export function toSnakeCase(str) {
    return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');
}

// Validate email format
export function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Get query parameters from URL
export function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    const result = {};
    
    for (const [key, value] of params) {
        result[key] = value;
    }
    
    return result;
}

// Set query parameters in URL
export function setQueryParam(key, value) {
    const url = new URL(window.location);
    if (value === null || value === undefined || value === '') {
        url.searchParams.delete(key);
    } else {
        url.searchParams.set(key, value);
    }
    window.history.replaceState({}, '', url);
}

// Copy text to clipboard
export async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {
        // Fallback for older browsers
        try {
            const textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.position = 'fixed';
            textArea.style.left = '-999999px';
            textArea.style.top = '-999999px';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            document.execCommand('copy');
            textArea.remove();
            return true;
        } catch (fallbackError) {
            console.error('Failed to copy to clipboard:', fallbackError);
            return false;
        }
    }
}

// Format price with appropriate precision
export function formatPrice(price, symbol = '') {
    if (price >= 100) {
        return formatCurrency(price, 'USD', 2);
    } else if (price >= 1) {
        return formatCurrency(price, 'USD', 3);
    } else {
        return formatCurrency(price, 'USD', 4);
    }
}

// Calculate position size based on risk
export function calculatePositionSize(accountBalance, riskPercent, entryPrice, stopLoss) {
    const riskAmount = accountBalance * (riskPercent / 100);
    const riskPerShare = Math.abs(entryPrice - stopLoss);
    
    if (riskPerShare === 0) return 0;
    
    return Math.floor(riskAmount / riskPerShare);
}

// Parse and validate number input
export function parseNumber(value, fallback = 0) {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? fallback : parsed;
}

// Format order type for display
export function formatOrderType(type) {
    const types = {
        'market': 'Market',
        'limit': 'Limit',
        'stop': 'Stop',
        'stop_limit': 'Stop Limit'
    };
    
    return types[type] || type;
}

// Get trading session status
export function getTradingSessionStatus() {
    const now = new Date();
    const day = now.getDay(); // 0 = Sunday, 6 = Saturday
    const hour = now.getHours();
    
    // Weekend
    if (day === 0 || day === 6) {
        return { status: 'closed', message: 'Markets are closed (Weekend)' };
    }
    
    // Weekday hours (9:30 AM - 4:00 PM EST)
    // Note: This is a simplified check, real implementation would consider holidays and time zones
    if (hour >= 9 && hour < 16) {
        return { status: 'open', message: 'Markets are open' };
    } else {
        return { status: 'closed', message: 'Markets are closed' };
    }
}