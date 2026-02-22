// Modal Dialog Component

import { generateId } from '../utils.js';

class Modal {
    constructor() {
        this.container = null;
        this.currentModal = null;
        this.bodyScrollLocked = false;
        this.init();
    }

    init() {
        // Get or create modal container
        this.container = document.getElementById('modal-container');
        if (!this.container) {
            this.container = document.createElement('div');
            this.container.id = 'modal-container';
            document.body.appendChild(this.container);
        }

        this.bindGlobalEvents();
    }

    show({ title, content, actions = [] }) {
        // Close existing modal first
        this.close();

        // Generate unique ID
        const modalId = generateId();

        // Lock body scroll
        this.lockBodyScroll();

        // Create modal element
        const modalElement = this.createModalElement(modalId, title, content, actions);

        // Add to container
        this.container.appendChild(modalElement);

        // Store reference
        this.currentModal = {
            id: modalId,
            element: modalElement
        };

        // Trigger entrance animation
        requestAnimationFrame(() => {
            modalElement.classList.add('show');
        });

        // Bind modal-specific events
        this.bindModalEvents(modalElement, actions);

        return modalId;
    }

    createModalElement(id, title, content, actions) {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.setAttribute('data-modal-id', id);

        modal.innerHTML = `
            <div class="modal__backdrop" data-backdrop="${id}"></div>
            <div class="modal__content">
                ${title ? `
                    <div class="modal__header">
                        <h3 class="modal__title">${this.escapeHtml(title)}</h3>
                        <button class="modal__close" data-close="${id}" aria-label="Close modal">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                ` : ''}
                <div class="modal__body">
                    ${content}
                </div>
                ${actions.length > 0 ? `
                    <div class="modal__footer">
                        ${this.renderActions(actions, id)}
                    </div>
                ` : ''}
            </div>
        `;

        return modal;
    }

    renderActions(actions, modalId) {
        return actions.map(action => {
            const variant = action.variant || 'secondary';
            return `
                <button class="btn btn-${variant}" 
                        data-action="${action.text}" 
                        data-modal="${modalId}"
                        ${action.disabled ? 'disabled' : ''}>
                    ${this.escapeHtml(action.text)}
                </button>
            `;
        }).join('');
    }

    bindModalEvents(modalElement, actions) {
        // Backdrop click to close
        const backdrop = modalElement.querySelector('.modal__backdrop');
        if (backdrop) {
            backdrop.addEventListener('click', () => this.close());
        }

        // Close button click
        const closeButton = modalElement.querySelector('[data-close]');
        if (closeButton) {
            closeButton.addEventListener('click', () => this.close());
        }

        // Action button clicks
        const actionButtons = modalElement.querySelectorAll('[data-action]');
        actionButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const actionText = button.getAttribute('data-action');
                const action = actions.find(a => a.text === actionText);
                
                if (action && action.onClick) {
                    const result = action.onClick(e);
                    
                    // If onClick returns false, don't close modal
                    if (result !== false) {
                        this.close();
                    }
                } else {
                    this.close();
                }
            });
        });
    }

    bindGlobalEvents() {
        // Escape key to close
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.currentModal) {
                this.close();
            }
        });
    }

    confirm(message, title = 'Confirm') {
        return new Promise((resolve) => {
            this.show({
                title,
                content: `<p>${this.escapeHtml(message)}</p>`,
                actions: [
                    {
                        text: 'Cancel',
                        variant: 'secondary',
                        onClick: () => resolve(false)
                    },
                    {
                        text: 'Confirm',
                        variant: 'primary',
                        onClick: () => resolve(true)
                    }
                ]
            });
        });
    }

    close() {
        if (!this.currentModal) return;

        const { element } = this.currentModal;

        // Add removing class for exit animation
        element.classList.add('removing');

        // Remove after animation completes
        setTimeout(() => {
            if (element.parentNode) {
                element.parentNode.removeChild(element);
            }
            
            // Unlock body scroll
            this.unlockBodyScroll();
            
            // Clear reference
            this.currentModal = null;
        }, 150); // Match CSS animation duration
    }

    lockBodyScroll() {
        if (!this.bodyScrollLocked) {
            document.body.style.overflow = 'hidden';
            this.bodyScrollLocked = true;
        }
    }

    unlockBodyScroll() {
        if (this.bodyScrollLocked) {
            document.body.style.overflow = '';
            this.bodyScrollLocked = false;
        }
    }

    // Utility method to escape HTML
    escapeHtml(text) {
        if (typeof text !== 'string') return text;
        
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Check if a modal is currently open
    isOpen() {
        return !!this.currentModal;
    }

    // Get current modal ID
    getCurrentModalId() {
        return this.currentModal ? this.currentModal.id : null;
    }

    // Update modal content
    updateContent(content) {
        if (!this.currentModal) return;

        const bodyElement = this.currentModal.element.querySelector('.modal__body');
        if (bodyElement) {
            bodyElement.innerHTML = content;
        }
    }

    // Update modal title
    updateTitle(title) {
        if (!this.currentModal) return;

        const titleElement = this.currentModal.element.querySelector('.modal__title');
        if (titleElement) {
            titleElement.textContent = title;
        }
    }

    // Destroy modal system
    destroy() {
        this.close();
        this.unlockBodyScroll();
        
        if (this.container && this.container.parentNode) {
            this.container.parentNode.removeChild(this.container);
        }
    }
}

// Create and export modal instance
const modal = new Modal();

export default modal;

// Add modal styles if not already present
if (!document.getElementById('modal-styles')) {
    const modalStyles = `
        .modal {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: var(--z-modal);
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--space-4);
            opacity: 0;
            animation: modalFadeIn var(--duration-medium, 250ms) ease-out forwards;
        }

        .modal.removing {
            animation: modalFadeOut var(--duration-fast, 150ms) ease-in forwards;
        }

        @keyframes modalFadeIn {
            to { opacity: 1; }
        }

        @keyframes modalFadeOut {
            to { opacity: 0; }
        }

        .modal__backdrop {
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            backdrop-filter: blur(4px);
        }

        .modal__content {
            position: relative;
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-xl);
            max-width: 500px;
            width: 100%;
            max-height: 90vh;
            overflow-y: auto;
            transform: translateY(20px) scale(0.95);
            animation: modalSlideUp var(--duration-medium, 250ms) ease-out forwards;
        }

        .modal.removing .modal__content {
            animation: modalSlideDown var(--duration-fast, 150ms) ease-in forwards;
        }

        @keyframes modalSlideUp {
            to {
                transform: translateY(0) scale(1);
            }
        }

        @keyframes modalSlideDown {
            to {
                transform: translateY(20px) scale(0.95);
                opacity: 0;
            }
        }

        .modal__header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--space-6) var(--space-6) var(--space-4);
            border-bottom: 1px solid var(--border);
        }

        .modal__title {
            font-size: 1.25rem;
            font-weight: 600;
            margin: 0;
            color: var(--text-primary);
        }

        .modal__close {
            background: none;
            border: none;
            color: var(--text-secondary);
            cursor: pointer;
            padding: var(--space-2);
            border-radius: var(--radius-sm);
            transition: all var(--transition-fast);
            font-size: 1.25rem;
        }

        .modal__close:hover {
            background: var(--bg-secondary);
            color: var(--text-primary);
        }

        .modal__body {
            padding: var(--space-6);
            color: var(--text-primary);
        }

        .modal__footer {
            padding: var(--space-4) var(--space-6) var(--space-6);
            border-top: 1px solid var(--border);
            display: flex;
            justify-content: flex-end;
            gap: var(--space-3);
        }

        @media (max-width: 640px) {
            .modal {
                padding: var(--space-2);
            }
            
            .modal__content {
                max-height: 95vh;
            }
            
            .modal__footer {
                flex-direction: column-reverse;
            }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'modal-styles';
    styleEl.textContent = modalStyles;
    document.head.appendChild(styleEl);
}