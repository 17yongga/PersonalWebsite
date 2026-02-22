// Toast Notification Component

import { generateId } from '../utils.js';

class Toast {
    constructor() {
        this.container = null;
        this.toasts = new Map();
        this.maxToasts = 3;
        this.defaultDuration = 4000; // 4 seconds
        this.init();
    }

    init() {
        // Get or create toast container
        this.container = document.getElementById('toast-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'toast-container';
            document.body.appendChild(this.container);
        }
    }

    show(type, message, options = {}) {
        const {
            title = null,
            duration = this.defaultDuration,
            actions = [],
            persistent = false
        } = options;

        // Generate unique ID for this toast
        const id = generateId();

        // Create toast element
        const toastElement = this.createToastElement(id, type, message, title, actions, persistent);

        // Add to container
        this.container.appendChild(toastElement);

        // Store toast reference
        const toastData = {
            id,
            element: toastElement,
            type,
            message,
            title,
            persistent,
            timer: null
        };
        this.toasts.set(id, toastData);

        // Manage toast count
        this.enforceMaxToasts();

        // Trigger entrance animation
        requestAnimationFrame(() => {
            toastElement.classList.add('show');
        });

        // Set auto-dismiss timer if not persistent
        if (!persistent && duration > 0) {
            toastData.timer = setTimeout(() => {
                this.dismiss(id);
            }, duration);
        }

        return id;
    }

    createToastElement(id, type, message, title, actions, persistent) {
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.setAttribute('data-toast-id', id);

        // Get icon for toast type
        const icon = this.getToastIcon(type);

        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${icon}"></i>
            </div>
            <div class="toast-content">
                ${title ? `<div class="toast-title">${this.escapeHtml(title)}</div>` : ''}
                <div class="toast-message">${this.escapeHtml(message)}</div>
                ${actions.length > 0 ? this.renderToastActions(actions, id) : ''}
            </div>
            ${!persistent ? `<button class="toast-dismiss" data-dismiss="${id}" aria-label="Dismiss notification">
                <i class="fas fa-times"></i>
            </button>` : ''}
        `;

        return toast;
    }

    renderToastActions(actions, toastId) {
        const actionsHtml = actions.map(action => {
            const variant = action.variant || 'secondary';
            return `
                <button class="btn btn-${variant} btn-sm toast-action" 
                        data-action="${action.id}" 
                        data-toast="${toastId}">
                    ${this.escapeHtml(action.text)}
                </button>
            `;
        }).join('');

        return `<div class="toast-actions">${actionsHtml}</div>`;
    }

    getToastIcon(type) {
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        return icons[type] || icons.info;
    }

    // Convenience methods for different toast types
    success(message, options = {}) {
        return this.show('success', message, options);
    }

    error(message, options = {}) {
        return this.show('error', message, { ...options, duration: options.duration || 6000 });
    }

    warning(message, options = {}) {
        return this.show('warning', message, options);
    }

    info(message, options = {}) {
        return this.show('info', message, options);
    }

    // Show loading toast that needs to be manually dismissed
    loading(message, options = {}) {
        return this.show('info', message, { 
            ...options, 
            persistent: true,
            title: options.title || 'Loading...'
        });
    }

    // Dismiss a specific toast
    dismiss(id) {
        const toastData = this.toasts.get(id);
        if (!toastData) return;

        // Clear timer if exists
        if (toastData.timer) {
            clearTimeout(toastData.timer);
        }

        const { element } = toastData;
        
        // Add removing class for exit animation
        element.classList.add('removing');

        // Remove after animation completes
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            this.toasts.delete(id);
        }, 200); // Match the CSS animation duration
    }

    // Dismiss all toasts
    dismissAll() {
        this.toasts.forEach((_, id) => {
            this.dismiss(id);
        });
    }

    // Update an existing toast
    update(id, message, options = {}) {
        const toastData = this.toasts.get(id);
        if (!toastData) return;

        const messageElement = toastData.element.querySelector('.toast-message');
        const titleElement = toastData.element.querySelector('.toast-title');

        if (messageElement) {
            messageElement.textContent = message;
        }

        if (options.title && titleElement) {
            titleElement.textContent = options.title;
        } else if (options.title && !titleElement) {
            // Add title if it didn't exist before
            const contentElement = toastData.element.querySelector('.toast-content');
            const titleEl = document.createElement('div');
            titleEl.className = 'toast-title';
            titleEl.textContent = options.title;
            contentElement.insertBefore(titleEl, messageElement);
        }

        // Update type if changed
        if (options.type && options.type !== toastData.type) {
            const element = toastData.element;
            element.className = element.className.replace(/toast-\w+/, `toast-${options.type}`);
            
            const iconElement = element.querySelector('.toast-icon i');
            if (iconElement) {
                iconElement.className = this.getToastIcon(options.type);
            }
            
            toastData.type = options.type;
        }

        // Reset timer if duration changed
        if (options.duration !== undefined && options.duration !== toastData.duration) {
            if (toastData.timer) {
                clearTimeout(toastData.timer);
            }
            
            if (!toastData.persistent && options.duration > 0) {
                toastData.timer = setTimeout(() => {
                    this.dismiss(id);
                }, options.duration);
            }
        }

        return id;
    }

    // Enforce maximum number of toasts
    enforceMaxToasts() {
        const toastArray = Array.from(this.toasts.values());
        
        if (toastArray.length > this.maxToasts) {
            // Remove oldest non-persistent toasts
            const oldestToasts = toastArray
                .filter(toast => !toast.persistent)
                .slice(0, toastArray.length - this.maxToasts);
            
            oldestToasts.forEach(toast => {
                this.dismiss(toast.id);
            });
        }
    }

    // Bind event listeners
    bindEvents() {
        // Use event delegation for toast interactions
        this.container.addEventListener('click', (e) => {
            const dismissBtn = e.target.closest('[data-dismiss]');
            const actionBtn = e.target.closest('.toast-action');

            if (dismissBtn) {
                e.preventDefault();
                const toastId = dismissBtn.getAttribute('data-dismiss');
                this.dismiss(toastId);
            } else if (actionBtn) {
                e.preventDefault();
                const toastId = actionBtn.getAttribute('data-toast');
                const actionId = actionBtn.getAttribute('data-action');
                this.handleToastAction(toastId, actionId);
            }
        });

        // Handle keyboard events
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Dismiss the newest non-persistent toast
                const toasts = Array.from(this.toasts.values());
                const dismissibleToast = toasts
                    .filter(toast => !toast.persistent)
                    .pop(); // Get newest

                if (dismissibleToast) {
                    this.dismiss(dismissibleToast.id);
                }
            }
        });
    }

    handleToastAction(toastId, actionId) {
        const toastData = this.toasts.get(toastId);
        if (!toastData) return;

        // Emit custom event for action handling
        const event = new CustomEvent('toast-action', {
            detail: {
                toastId,
                actionId,
                toastType: toastData.type,
                message: toastData.message
            }
        });

        document.dispatchEvent(event);

        // Auto-dismiss the toast after action
        this.dismiss(toastId);
    }

    // Utility method to escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Get current toast count
    getCount() {
        return this.toasts.size;
    }

    // Get all active toasts
    getAll() {
        return Array.from(this.toasts.values());
    }

    // Check if a specific toast exists
    exists(id) {
        return this.toasts.has(id);
    }

    // Show a confirmation toast with actions
    confirm(message, options = {}) {
        const {
            title = 'Confirm',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            confirmVariant = 'primary',
            cancelVariant = 'secondary'
        } = options;

        return new Promise((resolve) => {
            const actions = [
                {
                    id: 'cancel',
                    text: cancelText,
                    variant: cancelVariant
                },
                {
                    id: 'confirm',
                    text: confirmText,
                    variant: confirmVariant
                }
            ];

            const toastId = this.show('warning', message, {
                title,
                actions,
                persistent: true
            });

            // Listen for the action
            const handleAction = (e) => {
                if (e.detail.toastId === toastId) {
                    document.removeEventListener('toast-action', handleAction);
                    resolve(e.detail.actionId === 'confirm');
                }
            };

            document.addEventListener('toast-action', handleAction);
        });
    }

    // Clear all toasts and reset
    clear() {
        this.dismissAll();
        this.toasts.clear();
    }

    // Destroy the toast system
    destroy() {
        this.clear();
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

// Create and initialize toast instance
const toast = new Toast();

// Bind events when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => toast.bindEvents());
} else {
    toast.bindEvents();
}

export { toast };