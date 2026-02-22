// Login/Register Page

import { auth } from '../auth.js';
import { store } from '../store.js';
import { router } from '../router.js';
import { toast } from '../components/toast.js';
import { escapeHtml } from '../utils.js';

function LoginPage() {
    let currentTab = 'login'; // 'login' or 'register'
    let isSubmitting = false;

    async function render(container) {
        // Redirect if already authenticated
        if (auth.isAuthenticated()) {
            router.navigate('/');
            return;
        }

        container.innerHTML = `
            <div class="login-page">
                <div class="login-container">
                    <div class="login-card">
                        <div class="login-header">
                            <h1 class="login-title">
                                <span class="login-logo">📈</span>
                                PaperTrade
                            </h1>
                            <p class="login-subtitle">Practice trading with virtual money</p>
                        </div>

                        <div class="login-tabs">
                            <button class="tab-button ${currentTab === 'login' ? 'active' : ''}" 
                                    id="login-tab" data-tab="login">
                                Sign In
                            </button>
                            <button class="tab-button ${currentTab === 'register' ? 'active' : ''}" 
                                    id="register-tab" data-tab="register">
                                Create Account
                            </button>
                        </div>

                        <div class="login-content">
                            ${renderTabContent()}
                        </div>

                        <div class="login-footer">
                            <p class="disclaimer">
                                <i class="fas fa-info-circle"></i>
                                This is a simulation platform for educational purposes. 
                                No real money is involved.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bindEventListeners();
    }

    function renderTabContent() {
        if (currentTab === 'login') {
            return `
                <form class="login-form" id="login-form">
                    <div class="form-group">
                        <label class="form-label" for="login-email">Email</label>
                        <input type="email" 
                               id="login-email" 
                               class="form-input" 
                               required 
                               placeholder="Enter your email"
                               autocomplete="email">
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="login-password">Password</label>
                        <input type="password" 
                               id="login-password" 
                               class="form-input" 
                               required 
                               placeholder="Enter your password"
                               autocomplete="current-password">
                    </div>

                    <div class="form-error" id="login-error" style="display: none;"></div>

                    <button type="submit" class="btn btn-primary w-full login-submit" id="login-submit">
                        <span class="submit-text">Sign In</span>
                        <div class="spinner spinner-sm" style="display: none;"></div>
                    </button>
                </form>
            `;
        } else {
            return `
                <form class="register-form" id="register-form">
                    <div class="form-group">
                        <label class="form-label" for="register-email">Email</label>
                        <input type="email" 
                               id="register-email" 
                               class="form-input" 
                               required 
                               placeholder="Enter your email"
                               autocomplete="email">
                        <div class="form-error" id="email-error" style="display: none;"></div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="register-display-name">Display Name</label>
                        <input type="text" 
                               id="register-display-name" 
                               class="form-input" 
                               required 
                               placeholder="Enter your display name"
                               autocomplete="name"
                               minlength="2"
                               maxlength="50">
                        <div class="form-error" id="display-name-error" style="display: none;"></div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="register-password">Password</label>
                        <input type="password" 
                               id="register-password" 
                               class="form-input" 
                               required 
                               placeholder="Enter your password"
                               autocomplete="new-password"
                               minlength="8">
                        <div class="form-error" id="password-error" style="display: none;"></div>
                    </div>

                    <div class="form-group">
                        <label class="form-label" for="register-confirm-password">Confirm Password</label>
                        <input type="password" 
                               id="register-confirm-password" 
                               class="form-input" 
                               required 
                               placeholder="Confirm your password"
                               autocomplete="new-password">
                        <div class="form-error" id="confirm-password-error" style="display: none;"></div>
                    </div>

                    <div class="form-group">
                        <label class="checkbox-label">
                            <input type="checkbox" 
                                   id="register-agreement" 
                                   class="form-checkbox" 
                                   required>
                            I understand this is a simulation and no real money is involved
                        </label>
                        <div class="form-error" id="agreement-error" style="display: none;"></div>
                    </div>

                    <div class="form-error" id="register-error" style="display: none;"></div>

                    <button type="submit" class="btn btn-primary w-full register-submit" id="register-submit">
                        <span class="submit-text">Create Account</span>
                        <div class="spinner spinner-sm" style="display: none;"></div>
                    </button>
                </form>
            `;
        }
    }

    function bindEventListeners() {
        // Tab switching
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', (e) => {
                const tab = e.target.getAttribute('data-tab');
                switchTab(tab);
            });
        });

        // Form submissions
        const loginForm = document.getElementById('login-form');
        const registerForm = document.getElementById('register-form');

        if (loginForm) {
            loginForm.addEventListener('submit', handleLoginSubmit);
        }

        if (registerForm) {
            registerForm.addEventListener('submit', handleRegisterSubmit);
            
            // Real-time validation for register form
            bindRegisterValidation();
        }
    }

    function switchTab(tab) {
        currentTab = tab;
        
        // Update tab buttons
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.classList.toggle('active', button.getAttribute('data-tab') === tab);
        });

        // Update content
        const contentContainer = document.querySelector('.login-content');
        contentContainer.innerHTML = renderTabContent();

        // Rebind form events
        bindEventListeners();
    }

    async function handleLoginSubmit(e) {
        e.preventDefault();
        
        if (isSubmitting) return;

        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;

        // Clear previous errors
        hideError('login-error');

        // Basic validation
        if (!email || !password) {
            showError('login-error', 'Please fill in all fields');
            return;
        }

        if (!isValidEmail(email)) {
            showError('login-error', 'Please enter a valid email address');
            return;
        }

        try {
            setSubmitting(true, 'login');
            
            const result = await auth.login(email, password);
            
            if (result.success) {
                toast.success('Welcome back!');
                router.navigate('/');
            } else {
                showError('login-error', result.error);
            }
        } catch (error) {
            console.error('Login error:', error);
            showError('login-error', 'An unexpected error occurred. Please try again.');
        } finally {
            setSubmitting(false, 'login');
        }
    }

    async function handleRegisterSubmit(e) {
        e.preventDefault();
        
        if (isSubmitting) return;

        const email = document.getElementById('register-email').value.trim();
        const displayName = document.getElementById('register-display-name').value.trim();
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const agreementChecked = document.getElementById('register-agreement').checked;

        // Clear previous errors
        clearAllErrors();

        // Validate all fields
        const validationErrors = validateRegisterForm(email, displayName, password, confirmPassword, agreementChecked);
        
        if (validationErrors.length > 0) {
            validationErrors.forEach(error => showError(error.field, error.message));
            return;
        }

        try {
            setSubmitting(true, 'register');
            
            const result = await auth.register(email, password, displayName);
            
            if (result.success) {
                toast.success('Account created successfully! Welcome to PaperTrade!');
                router.navigate('/');
            } else {
                showError('register-error', result.error);
            }
        } catch (error) {
            console.error('Register error:', error);
            showError('register-error', 'An unexpected error occurred. Please try again.');
        } finally {
            setSubmitting(false, 'register');
        }
    }

    function bindRegisterValidation() {
        const fields = [
            { id: 'register-email', validator: validateEmailField },
            { id: 'register-display-name', validator: validateDisplayNameField },
            { id: 'register-password', validator: validatePasswordField },
            { id: 'register-confirm-password', validator: validateConfirmPasswordField }
        ];

        fields.forEach(({ id, validator }) => {
            const field = document.getElementById(id);
            if (field) {
                field.addEventListener('blur', validator);
                field.addEventListener('input', debounceValidation(validator, 500));
            }
        });
    }

    function validateEmailField() {
        const email = document.getElementById('register-email').value.trim();
        const errorField = 'email-error';
        
        hideError(errorField);
        
        if (email && !isValidEmail(email)) {
            showError(errorField, 'Please enter a valid email address');
        }
    }

    function validateDisplayNameField() {
        const displayName = document.getElementById('register-display-name').value.trim();
        const errorField = 'display-name-error';
        
        hideError(errorField);
        
        if (displayName) {
            if (displayName.length < 2) {
                showError(errorField, 'Display name must be at least 2 characters');
            } else if (displayName.length > 50) {
                showError(errorField, 'Display name must be less than 50 characters');
            }
        }
    }

    function validatePasswordField() {
        const password = document.getElementById('register-password').value;
        const errorField = 'password-error';
        
        hideError(errorField);
        
        if (password && password.length < 8) {
            showError(errorField, 'Password must be at least 8 characters');
        }
    }

    function validateConfirmPasswordField() {
        const password = document.getElementById('register-password').value;
        const confirmPassword = document.getElementById('register-confirm-password').value;
        const errorField = 'confirm-password-error';
        
        hideError(errorField);
        
        if (confirmPassword && password !== confirmPassword) {
            showError(errorField, 'Passwords do not match');
        }
    }

    function validateRegisterForm(email, displayName, password, confirmPassword, agreementChecked) {
        const errors = [];

        if (!email) {
            errors.push({ field: 'email-error', message: 'Email is required' });
        } else if (!isValidEmail(email)) {
            errors.push({ field: 'email-error', message: 'Please enter a valid email address' });
        }

        if (!displayName) {
            errors.push({ field: 'display-name-error', message: 'Display name is required' });
        } else if (displayName.length < 2) {
            errors.push({ field: 'display-name-error', message: 'Display name must be at least 2 characters' });
        } else if (displayName.length > 50) {
            errors.push({ field: 'display-name-error', message: 'Display name must be less than 50 characters' });
        }

        if (!password) {
            errors.push({ field: 'password-error', message: 'Password is required' });
        } else if (password.length < 8) {
            errors.push({ field: 'password-error', message: 'Password must be at least 8 characters' });
        }

        if (!confirmPassword) {
            errors.push({ field: 'confirm-password-error', message: 'Please confirm your password' });
        } else if (password !== confirmPassword) {
            errors.push({ field: 'confirm-password-error', message: 'Passwords do not match' });
        }

        if (!agreementChecked) {
            errors.push({ field: 'agreement-error', message: 'You must acknowledge this is a simulation' });
        }

        return errors;
    }

    function setSubmitting(submitting, form) {
        isSubmitting = submitting;
        const submitButton = document.getElementById(`${form}-submit`);
        const submitText = submitButton.querySelector('.submit-text');
        const spinner = submitButton.querySelector('.spinner');

        if (submitting) {
            submitButton.disabled = true;
            submitText.style.display = 'none';
            spinner.style.display = 'inline-block';
        } else {
            submitButton.disabled = false;
            submitText.style.display = 'inline';
            spinner.style.display = 'none';
        }
    }

    function showError(fieldId, message) {
        const errorElement = document.getElementById(fieldId);
        if (errorElement) {
            errorElement.textContent = message;
            errorElement.style.display = 'block';
        }
    }

    function hideError(fieldId) {
        const errorElement = document.getElementById(fieldId);
        if (errorElement) {
            errorElement.style.display = 'none';
            errorElement.textContent = '';
        }
    }

    function clearAllErrors() {
        const errorElements = document.querySelectorAll('.form-error');
        errorElements.forEach(element => {
            element.style.display = 'none';
            element.textContent = '';
        });
    }

    function isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    function debounceValidation(validator, delay) {
        let timeoutId;
        return function() {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(validator, delay);
        };
    }

    function destroy() {
        // Clean up any ongoing requests or timers
        isSubmitting = false;
    }

    return { render, destroy };
}

// Export the page function
export default LoginPage;

// Add login page specific styles
if (!document.getElementById('login-page-styles')) {
    const loginPageStyles = `
        .login-page {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--space-4);
            background: linear-gradient(135deg, 
                var(--bg-primary) 0%, 
                var(--bg-secondary) 100%);
        }

        .login-container {
            width: 100%;
            max-width: 400px;
        }

        .login-card {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            padding: var(--space-8);
            box-shadow: var(--shadow-xl);
        }

        .login-header {
            text-align: center;
            margin-bottom: var(--space-8);
        }

        .login-title {
            font-size: 1.875rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: var(--space-2);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
        }

        .login-logo {
            font-size: 2rem;
        }

        .login-subtitle {
            color: var(--text-secondary);
            font-size: 0.875rem;
            margin: 0;
        }

        .login-tabs {
            display: flex;
            margin-bottom: var(--space-6);
            border-bottom: 1px solid var(--border);
        }

        .login-tabs .tab-button {
            flex: 1;
            background: none;
            border: none;
            padding: var(--space-3) var(--space-4);
            font-family: var(--font-family);
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-secondary);
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all var(--transition-fast);
        }

        .login-tabs .tab-button:hover {
            color: var(--text-primary);
        }

        .login-tabs .tab-button.active {
            color: var(--accent);
            border-bottom-color: var(--accent);
        }

        .login-content {
            margin-bottom: var(--space-6);
        }

        .login-form,
        .register-form {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
        }

        .checkbox-label {
            display: flex;
            align-items: flex-start;
            gap: var(--space-2);
            font-size: 0.875rem;
            color: var(--text-primary);
            cursor: pointer;
            line-height: 1.4;
        }

        .checkbox-label input[type="checkbox"] {
            margin: 0;
            flex-shrink: 0;
        }

        .w-full {
            width: 100%;
        }

        .login-submit,
        .register-submit {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
            margin-top: var(--space-2);
        }

        .submit-text {
            transition: opacity var(--transition-fast);
        }

        .login-footer {
            text-align: center;
            padding-top: var(--space-6);
            border-top: 1px solid var(--border);
        }

        .disclaimer {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: var(--space-2);
            color: var(--text-secondary);
            font-size: 0.75rem;
            margin: 0;
            line-height: 1.4;
        }

        .disclaimer i {
            color: var(--warning);
            flex-shrink: 0;
        }

        /* Form error styling */
        .form-error {
            color: var(--danger);
            font-size: 0.75rem;
            margin-top: var(--space-1);
        }

        .form-group .form-error {
            margin-top: var(--space-1);
            margin-bottom: 0;
        }

        /* Loading state */
        .login-submit:disabled,
        .register-submit:disabled {
            opacity: 0.7;
            cursor: not-allowed;
        }

        /* Focus states */
        .form-input:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
        }

        .form-checkbox:focus {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }

        /* Responsive design */
        @media (max-width: 480px) {
            .login-card {
                padding: var(--space-6);
            }
            
            .login-title {
                font-size: 1.5rem;
            }
            
            .disclaimer {
                flex-direction: column;
                gap: var(--space-1);
                text-align: center;
            }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'login-page-styles';
    styleEl.textContent = loginPageStyles;
    document.head.appendChild(styleEl);
}