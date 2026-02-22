// Page Not Found Page

function notFoundPage() {
    async function render(container, params) {
        container.innerHTML = `
            <div class="not-found-page">
                <div class="not-found-content">
                    <div class="not-found-visual">
                        <div class="not-found-number">404</div>
                        <div class="not-found-icon">
                            <i class="fas fa-chart-line-down"></i>
                        </div>
                    </div>
                    
                    <div class="not-found-message">
                        <h1>Page Not Found</h1>
                        <p class="not-found-description">
                            Looks like this page took an unexpected dip! 📉<br>
                            The page you're looking for doesn't exist or may have been moved.
                        </p>
                        
                        <div class="not-found-suggestions">
                            <h3>Try one of these instead:</h3>
                            <div class="suggestion-links">
                                <a href="#/" class="suggestion-link">
                                    <i class="fas fa-tachometer-alt"></i>
                                    <span>Dashboard</span>
                                </a>
                                <a href="#/trade" class="suggestion-link">
                                    <i class="fas fa-chart-line"></i>
                                    <span>Start Trading</span>
                                </a>
                                <a href="#/profile" class="suggestion-link">
                                    <i class="fas fa-user"></i>
                                    <span>Profile</span>
                                </a>
                            </div>
                        </div>

                        <div class="not-found-actions">
                            <button class="btn btn-primary" onclick="window.location.hash='#/'">
                                <i class="fas fa-home"></i>
                                Go Home
                            </button>
                            <button class="btn btn-secondary" onclick="window.history.back()">
                                <i class="fas fa-arrow-left"></i>
                                Go Back
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function destroy() {}

    return { render, destroy };
}

export default notFoundPage;

// Add 404 page specific styles
if (!document.getElementById('not-found-page-styles')) {
    const notFoundPageStyles = `
        .not-found-page {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 70vh;
            padding: var(--space-6) var(--space-4);
        }

        .not-found-content {
            text-align: center;
            max-width: 600px;
        }

        .not-found-visual {
            position: relative;
            margin-bottom: var(--space-8);
        }

        .not-found-number {
            font-size: 8rem;
            font-weight: 900;
            color: var(--text-primary);
            line-height: 1;
            opacity: 0.1;
            user-select: none;
        }

        .not-found-icon {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            font-size: 4rem;
            color: var(--danger);
        }

        .not-found-message h1 {
            font-size: 2.5rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0 0 var(--space-4) 0;
        }

        .not-found-description {
            font-size: 1.125rem;
            color: var(--text-secondary);
            margin-bottom: var(--space-8);
            line-height: 1.6;
        }

        .not-found-suggestions {
            margin-bottom: var(--space-8);
        }

        .not-found-suggestions h3 {
            font-size: 1.25rem;
            color: var(--text-primary);
            margin-bottom: var(--space-4);
        }

        .suggestion-links {
            display: flex;
            justify-content: center;
            gap: var(--space-4);
            flex-wrap: wrap;
        }

        .suggestion-link {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: var(--space-2);
            padding: var(--space-4);
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-lg);
            color: var(--text-secondary);
            text-decoration: none;
            transition: all var(--transition-fast);
            min-width: 120px;
        }

        .suggestion-link:hover {
            color: var(--accent);
            border-color: var(--accent);
            transform: translateY(-2px);
            box-shadow: var(--shadow-md);
        }

        .suggestion-link i {
            font-size: 1.5rem;
        }

        .suggestion-link span {
            font-size: 0.875rem;
            font-weight: 500;
        }

        .not-found-actions {
            display: flex;
            justify-content: center;
            gap: var(--space-3);
            flex-wrap: wrap;
        }

        /* Responsive design */
        @media (max-width: 767px) {
            .not-found-page {
                padding: var(--space-4) var(--space-3);
                min-height: 60vh;
            }
            
            .not-found-number {
                font-size: 6rem;
            }
            
            .not-found-icon {
                font-size: 3rem;
            }
            
            .not-found-message h1 {
                font-size: 2rem;
            }
            
            .not-found-description {
                font-size: 1rem;
            }
            
            .suggestion-links {
                gap: var(--space-2);
            }
            
            .suggestion-link {
                min-width: 100px;
                padding: var(--space-3);
            }
            
            .not-found-actions {
                flex-direction: column;
                gap: var(--space-2);
            }
            
            .not-found-actions .btn {
                width: 100%;
            }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'not-found-page-styles';
    styleEl.textContent = notFoundPageStyles;
    document.head.appendChild(styleEl);
}
