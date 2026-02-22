// Profile Page

import { auth } from '../auth.js';
import { store } from '../store.js';
import { toast } from '../components/toast.js';
import { formatDate, escapeHtml } from '../utils.js';

function profilePage() {
    let unsubscribers = [];
    let isSubmitting = false;

    async function render(container, params) {
        const user = store.getState('user');
        
        if (!user) {
            container.innerHTML = `
                <div class="profile-loading">
                    <div class="spinner"></div>
                    <p>Loading profile...</p>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div class="profile-page">
                <div class="profile-header">
                    <h1>Profile Settings</h1>
                    <p class="profile-subtitle">Manage your account information and security settings</p>
                </div>

                <div class="profile-layout">
                    <!-- User Information -->
                    <div class="profile-section">
                        <div class="section-header">
                            <h2 class="section-title">Account Information</h2>
                        </div>
                        <div class="profile-card">
                            <div class="user-avatar-large">
                                <span class="user-initials">${getInitials(user.display_name)}</span>
                            </div>
                            <div class="user-details">
                                <div class="user-detail">
                                    <label class="detail-label">Display Name</label>
                                    <div class="detail-value">${escapeHtml(user.display_name || 'Not set')}</div>
                                </div>
                                <div class="user-detail">
                                    <label class="detail-label">Email Address</label>
                                    <div class="detail-value">${escapeHtml(user.email || 'Not set')}</div>
                                </div>
                                <div class="user-detail">
                                    <label class="detail-label">Member Since</label>
                                    <div class="detail-value">${user.created_at ? formatDate(user.created_at) : 'Unknown'}</div>
                                </div>
                                <div class="user-detail">
                                    <label class="detail-label">Account Status</label>
                                    <div class="detail-value">
                                        <span class="status-badge ${user.email_verified ? 'status-verified' : 'status-unverified'}">
                                            ${user.email_verified ? 'Verified' : 'Unverified'}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        ${!user.email_verified ? `
                            <div class="verification-notice">
                                <div class="notice-content">
                                    <i class="fas fa-exclamation-triangle"></i>
                                    <div>
                                        <strong>Email verification required</strong>
                                        <p>Please verify your email address to access all features.</p>
                                    </div>
                                </div>
                                <button class="btn btn-primary" id="resend-verification-btn">
                                    Resend Verification Email
                                </button>
                            </div>
                        ` : ''}
                    </div>

                    <!-- Update Display Name -->
                    <div class="profile-section">
                        <div class="section-header">
                            <h2 class="section-title">Update Display Name</h2>
                        </div>
                        <div class="profile-card">
                            <form id="update-name-form" class="profile-form">
                                <div class="form-group">
                                    <label class="form-label" for="display-name-input">Display Name</label>
                                    <input type="text" 
                                           id="display-name-input" 
                                           class="form-input" 
                                           value="${escapeHtml(user.display_name || '')}"
                                           placeholder="Enter your display name"
                                           maxlength="50"
                                           required>
                                    <div class="form-help">This is how your name will appear to other users</div>
                                </div>
                                <button type="submit" class="btn btn-primary" id="update-name-btn">
                                    Update Display Name
                                </button>
                            </form>
                        </div>
                    </div>

                    <!-- Change Password -->
                    <div class="profile-section">
                        <div class="section-header">
                            <h2 class="section-title">Change Password</h2>
                        </div>
                        <div class="profile-card">
                            <form id="change-password-form" class="profile-form">
                                <div class="form-group">
                                    <label class="form-label" for="current-password">Current Password</label>
                                    <input type="password" 
                                           id="current-password" 
                                           class="form-input" 
                                           placeholder="Enter your current password"
                                           required>
                                </div>
                                
                                <div class="form-group">
                                    <label class="form-label" for="new-password">New Password</label>
                                    <input type="password" 
                                           id="new-password" 
                                           class="form-input" 
                                           placeholder="Enter your new password"
                                           minlength="8"
                                           required>
                                    <div class="form-help">Must be at least 8 characters with uppercase, lowercase, number, and special character</div>
                                </div>
                                
                                <div class="form-group">
                                    <label class="form-label" for="confirm-password">Confirm New Password</label>
                                    <input type="password" 
                                           id="confirm-password" 
                                           class="form-input" 
                                           placeholder="Confirm your new password"
                                           required>
                                </div>
                                
                                <button type="submit" class="btn btn-primary" id="change-password-btn">
                                    Change Password
                                </button>
                            </form>
                        </div>
                    </div>

                    <!-- Account Actions -->
                    <div class="profile-section">
                        <div class="section-header">
                            <h2 class="section-title">Account Actions</h2>
                        </div>
                        <div class="profile-card">
                            <div class="account-actions">
                                <button class="btn btn-secondary" onclick="window.location.hash='#/'">
                                    <i class="fas fa-arrow-left"></i>
                                    Back to Dashboard
                                </button>
                                <button class="btn btn-danger" id="logout-btn">
                                    <i class="fas fa-sign-out-alt"></i>
                                    Logout
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        bindEventListeners();
        setupStoreSubscriptions();
    }

    function getInitials(name) {
        if (!name) return 'U';
        
        return name
            .split(' ')
            .map(part => part.charAt(0).toUpperCase())
            .slice(0, 2)
            .join('');
    }

    function bindEventListeners() {
        // Resend verification email
        const resendBtn = document.getElementById('resend-verification-btn');
        if (resendBtn) {
            resendBtn.addEventListener('click', handleResendVerification);
        }

        // Update display name form
        const updateNameForm = document.getElementById('update-name-form');
        if (updateNameForm) {
            updateNameForm.addEventListener('submit', handleUpdateDisplayName);
        }

        // Change password form
        const changePasswordForm = document.getElementById('change-password-form');
        if (changePasswordForm) {
            changePasswordForm.addEventListener('submit', handleChangePassword);
        }

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        // Real-time password confirmation validation
        const newPasswordInput = document.getElementById('new-password');
        const confirmPasswordInput = document.getElementById('confirm-password');
        
        if (newPasswordInput && confirmPasswordInput) {
            const validatePasswordMatch = () => {
                const newPassword = newPasswordInput.value;
                const confirmPassword = confirmPasswordInput.value;
                
                if (confirmPassword && newPassword !== confirmPassword) {
                    confirmPasswordInput.setCustomValidity('Passwords do not match');
                } else {
                    confirmPasswordInput.setCustomValidity('');
                }
            };

            newPasswordInput.addEventListener('input', validatePasswordMatch);
            confirmPasswordInput.addEventListener('input', validatePasswordMatch);
        }
    }

    function setupStoreSubscriptions() {
        // Re-render if user data changes
        unsubscribers.push(
            store.subscribe('user', (newUser) => {
                if (newUser) {
                    // Update user details in the DOM without full re-render
                    updateUserDetails(newUser);
                }
            })
        );
    }

    function updateUserDetails(user) {
        // Update avatar initials
        const avatarInitials = document.querySelector('.user-initials');
        if (avatarInitials) {
            avatarInitials.textContent = getInitials(user.display_name);
        }

        // Update display name in details
        const displayNameDetail = document.querySelector('.user-detail:nth-child(1) .detail-value');
        if (displayNameDetail) {
            displayNameDetail.textContent = user.display_name || 'Not set';
        }

        // Update verification status
        const statusBadge = document.querySelector('.status-badge');
        if (statusBadge) {
            statusBadge.className = `status-badge ${user.email_verified ? 'status-verified' : 'status-unverified'}`;
            statusBadge.textContent = user.email_verified ? 'Verified' : 'Unverified';
        }

        // Update form input
        const displayNameInput = document.getElementById('display-name-input');
        if (displayNameInput) {
            displayNameInput.value = user.display_name || '';
        }
    }

    async function handleResendVerification() {
        const btn = document.getElementById('resend-verification-btn');
        const originalText = btn.textContent;
        
        try {
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner spinner-sm"></span> Sending...';

            const result = await auth.resendVerificationEmail();
            
            if (result.success) {
                toast.success('Verification email sent successfully');
                btn.textContent = 'Email Sent!';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 3000);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Failed to resend verification:', error);
            toast.error(error.message || 'Failed to send verification email');
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }

    async function handleUpdateDisplayName(e) {
        e.preventDefault();
        
        if (isSubmitting) return;

        const form = e.target;
        const formData = new FormData(form);
        const displayName = document.getElementById('display-name-input').value.trim();

        // Validation
        const validation = auth.validateDisplayName(displayName);
        if (!validation.valid) {
            toast.error(validation.errors[0]);
            return;
        }

        const btn = document.getElementById('update-name-btn');
        const originalText = btn.textContent;

        try {
            isSubmitting = true;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner spinner-sm"></span> Updating...';

            const result = await auth.updateProfile({ display_name: displayName });
            
            if (result.success) {
                toast.success('Display name updated successfully');
                btn.textContent = 'Updated!';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 2000);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Failed to update display name:', error);
            toast.error(error.message || 'Failed to update display name');
            btn.textContent = originalText;
            btn.disabled = false;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleChangePassword(e) {
        e.preventDefault();
        
        if (isSubmitting) return;

        const currentPassword = document.getElementById('current-password').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;

        // Validation
        if (newPassword !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }

        const validation = auth.validatePassword(newPassword);
        if (!validation.valid) {
            toast.error(validation.errors[0]);
            return;
        }

        const btn = document.getElementById('change-password-btn');
        const originalText = btn.textContent;

        try {
            isSubmitting = true;
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner spinner-sm"></span> Changing...';

            const result = await auth.changePassword(currentPassword, newPassword);
            
            if (result.success) {
                toast.success('Password changed successfully');
                
                // Clear form
                document.getElementById('current-password').value = '';
                document.getElementById('new-password').value = '';
                document.getElementById('confirm-password').value = '';
                
                btn.textContent = 'Changed!';
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.disabled = false;
                }, 2000);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Failed to change password:', error);
            toast.error(error.message || 'Failed to change password');
            btn.textContent = originalText;
            btn.disabled = false;
        } finally {
            isSubmitting = false;
        }
    }

    async function handleLogout() {
        if (!confirm('Are you sure you want to logout?')) {
            return;
        }

        try {
            await auth.logout();
        } catch (error) {
            console.error('Logout error:', error);
            // Still redirect on error
            window.location.hash = '#/login';
        }
    }

    function destroy() {
        // Clean up subscriptions
        unsubscribers.forEach(unsub => unsub());
        unsubscribers = [];
        
        isSubmitting = false;
    }

    return { render, destroy };
}

export default profilePage;

// Add profile page specific styles
if (!document.getElementById('profile-page-styles')) {
    const profilePageStyles = `
        .profile-page {
            max-width: 800px;
            margin: 0 auto;
            padding: var(--space-6) var(--space-4);
        }

        .profile-header {
            text-align: center;
            margin-bottom: var(--space-8);
        }

        .profile-header h1 {
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-primary);
            margin: 0 0 var(--space-2) 0;
        }

        .profile-subtitle {
            color: var(--text-secondary);
            font-size: 1rem;
            margin: 0;
        }

        .profile-layout {
            display: flex;
            flex-direction: column;
            gap: var(--space-6);
        }

        .profile-section {
            background: var(--card-bg);
            border: 1px solid var(--border);
            border-radius: var(--radius-xl);
            overflow: hidden;
        }

        .section-header {
            padding: var(--space-6) var(--space-6) 0;
        }

        .section-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--text-primary);
            margin: 0 0 var(--space-4) 0;
        }

        .profile-card {
            padding: var(--space-6);
        }

        .user-avatar-large {
            width: 80px;
            height: 80px;
            border-radius: var(--radius-full);
            background: var(--accent);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 700;
            font-size: 2rem;
            margin: 0 auto var(--space-6);
            box-shadow: var(--shadow-lg);
        }

        .user-details {
            display: grid;
            gap: var(--space-4);
        }

        .user-detail {
            display: grid;
            gap: var(--space-1);
        }

        .detail-label {
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--text-secondary);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .detail-value {
            font-size: 1rem;
            color: var(--text-primary);
            font-weight: 500;
        }

        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: var(--space-1) var(--space-2);
            font-size: 0.75rem;
            font-weight: 600;
            border-radius: var(--radius-full);
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }

        .status-verified {
            background: rgba(16, 185, 129, 0.1);
            color: var(--success);
            border: 1px solid rgba(16, 185, 129, 0.2);
        }

        .status-unverified {
            background: rgba(245, 158, 11, 0.1);
            color: var(--warning);
            border: 1px solid rgba(245, 158, 11, 0.2);
        }

        .verification-notice {
            background: rgba(245, 158, 11, 0.1);
            border: 1px solid rgba(245, 158, 11, 0.2);
            border-radius: var(--radius-lg);
            padding: var(--space-4);
            margin-top: var(--space-4);
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--space-4);
        }

        .notice-content {
            display: flex;
            align-items: flex-start;
            gap: var(--space-3);
            flex: 1;
        }

        .notice-content i {
            color: var(--warning);
            font-size: 1.25rem;
            margin-top: var(--space-1);
        }

        .notice-content strong {
            color: var(--text-primary);
            font-weight: 600;
            margin-bottom: var(--space-1);
            display: block;
        }

        .notice-content p {
            color: var(--text-secondary);
            font-size: 0.875rem;
            margin: 0;
        }

        .profile-form {
            display: flex;
            flex-direction: column;
            gap: var(--space-4);
        }

        .profile-form .form-group:last-of-type {
            margin-bottom: var(--space-2);
        }

        .account-actions {
            display: flex;
            gap: var(--space-3);
            justify-content: space-between;
            align-items: center;
        }

        .profile-loading {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 400px;
            gap: var(--space-4);
        }

        .profile-loading p {
            color: var(--text-secondary);
            margin: 0;
        }

        /* Responsive design */
        @media (max-width: 767px) {
            .profile-page {
                padding: var(--space-4) var(--space-3);
            }
            
            .profile-header h1 {
                font-size: 1.75rem;
            }
            
            .profile-card {
                padding: var(--space-4);
            }
            
            .section-header {
                padding: var(--space-4) var(--space-4) 0;
            }
            
            .verification-notice {
                flex-direction: column;
                align-items: flex-start;
                gap: var(--space-3);
            }
            
            .account-actions {
                flex-direction: column;
                gap: var(--space-2);
            }
            
            .account-actions .btn {
                width: 100%;
            }
            
            .user-avatar-large {
                width: 64px;
                height: 64px;
                font-size: 1.5rem;
            }
            
            .user-details {
                text-align: center;
            }
        }
    `;

    const styleEl = document.createElement('style');
    styleEl.id = 'profile-page-styles';
    styleEl.textContent = profilePageStyles;
    document.head.appendChild(styleEl);
}
