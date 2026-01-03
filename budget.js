// Budget Application JavaScript

// API URL configuration
// Local development: uses port 8002 (Ask-Gary uses 8000, Casino uses 3001)
// Production: update to your production URL
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8002'
    : 'https://gary-yong.com/api/budget';

let currentUserId = null;
let categoryChart = null;
let budgetChart = null;

// Initialize application
document.addEventListener('DOMContentLoaded', async () => {
    // Check for existing user in localStorage
    currentUserId = localStorage.getItem('budget_user_id');
    
    if (!currentUserId) {
        showSetupModal();
    } else {
        await loadDashboard();
    }
    
    setupEventListeners();
});

function setupEventListeners() {
    // Setup form
    document.getElementById('setupForm').addEventListener('submit', handleSetup);
    
    // Receipt upload
    document.getElementById('uploadReceiptBtn').addEventListener('click', () => {
        showModal('receiptModal');
    });
    
    const uploadArea = document.getElementById('uploadArea');
    const receiptFile = document.getElementById('receiptFile');
    
    uploadArea.addEventListener('click', () => receiptFile.click());
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('drop', handleDrop);
    receiptFile.addEventListener('change', handleFileSelect);
    
    document.getElementById('processReceiptBtn').addEventListener('click', processReceipt);
    
    // Transaction modal
    document.getElementById('addTransactionBtn').addEventListener('click', () => {
        loadCategories();
        showModal('transactionModal');
    });
    
    document.getElementById('transactionForm').addEventListener('submit', handleAddTransaction);
    
    // Recommendations
    document.getElementById('viewRecommendationsBtn').addEventListener('click', async () => {
        await loadRecommendations();
        showModal('recommendationsModal');
    });
    
    // Close modals
    document.querySelectorAll('.close').forEach(closeBtn => {
        closeBtn.addEventListener('click', (e) => {
            const modal = e.target.closest('.modal');
            hideModal(modal.id);
        });
    });
    
    // Close modal on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                hideModal(modal.id);
            }
        });
    });
}

// Setup Modal
function showSetupModal() {
    showModal('setupModal');
}

async function handleSetup(e) {
    e.preventDefault();
    
    const email = document.getElementById('userEmail').value;
    const monthlyIncome = parseFloat(document.getElementById('monthlyIncome').value);
    const currency = document.getElementById('currency').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                monthly_income: monthlyIncome,
                currency,
            }),
        });
        
        if (!response.ok) throw new Error('Failed to create user');
        
        const user = await response.json();
        currentUserId = user.id;
        localStorage.setItem('budget_user_id', currentUserId);
        
        hideModal('setupModal');
        await loadDashboard();
    } catch (error) {
        alert('Error setting up account: ' + error.message);
    }
}

// Dashboard Loading
async function loadDashboard() {
    if (!currentUserId) return;
    
    try {
        await Promise.all([
            loadSummary(),
            loadCategories(),
            loadTransactions(),
        ]);
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

async function loadSummary() {
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUserId}/summary`);
        if (!response.ok) throw new Error('Failed to load summary');
        
        const summary = await response.json();
        
        // Update summary cards
        document.getElementById('totalBudget').textContent = formatCurrency(summary.total_budget);
        document.getElementById('totalSpent').textContent = formatCurrency(summary.total_spent);
        document.getElementById('remainingBudget').textContent = formatCurrency(summary.remaining_budget);
        
        // Update charts
        updateCategoryChart(summary.by_category);
        updateBudgetChart(summary.by_category);
        
        // Update category list
        updateCategoryList(summary.by_category);
    } catch (error) {
        console.error('Error loading summary:', error);
    }
}

function updateCategoryChart(byCategory) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    
    if (categoryChart) {
        categoryChart.destroy();
    }
    
    const categories = Object.keys(byCategory);
    const spent = categories.map(cat => byCategory[cat].spent);
    
    categoryChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: categories,
            datasets: [{
                data: spent,
                backgroundColor: [
                    '#38bdf8', '#22c55e', '#f59e0b', '#ef4444', '#a855f7',
                    '#ec4899', '#06b6d4', '#84cc16', '#f97316', '#6366f1'
                ],
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text'),
                    },
                },
            },
        },
    });
}

function updateBudgetChart(byCategory) {
    const ctx = document.getElementById('budgetChart').getContext('2d');
    
    if (budgetChart) {
        budgetChart.destroy();
    }
    
    const categories = Object.keys(byCategory);
    const budgets = categories.map(cat => byCategory[cat].budget);
    const spent = categories.map(cat => byCategory[cat].spent);
    
    budgetChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: categories,
            datasets: [
                {
                    label: 'Budget',
                    data: budgets,
                    backgroundColor: 'rgba(56, 189, 248, 0.5)',
                },
                {
                    label: 'Spent',
                    data: spent,
                    backgroundColor: 'rgba(34, 197, 94, 0.5)',
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text'),
                    },
                    grid: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-border'),
                    },
                },
                x: {
                    ticks: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text'),
                    },
                    grid: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-border'),
                    },
                },
            },
            plugins: {
                legend: {
                    labels: {
                        color: getComputedStyle(document.documentElement).getPropertyValue('--color-text'),
                    },
                },
            },
        },
    });
}

function updateCategoryList(byCategory) {
    const container = document.getElementById('categoryList');
    container.innerHTML = '';
    
    const categories = Object.entries(byCategory).sort((a, b) => b[1].spent - a[1].spent);
    
    categories.forEach(([category, data]) => {
        const isOverBudget = data.remaining < 0;
        const percentage = data.budget > 0 ? (data.spent / data.budget) * 100 : 0;
        
        const item = document.createElement('div');
        item.className = `category-item ${isOverBudget ? 'over-budget' : 'under-budget'}`;
        
        item.innerHTML = `
            <div class="category-info">
                <h3 class="category-name">${category}</h3>
                <div class="category-stats">
                    <span>Budget: ${formatCurrency(data.budget)}</span>
                    <span>Spent: ${formatCurrency(data.spent)}</span>
                </div>
            </div>
            <div class="category-progress">
                <div class="progress-bar-container">
                    <div class="progress-bar-fill ${isOverBudget ? 'over-budget' : 'under-budget'}" 
                         style="width: ${Math.min(percentage, 100)}%"></div>
                </div>
                <div class="progress-text">${percentage.toFixed(1)}% used</div>
            </div>
            <div class="category-amount">
                <div>${formatCurrency(Math.abs(data.remaining))}</div>
                <div style="font-size: 0.75rem; color: var(--color-muted);">
                    ${isOverBudget ? 'Over' : 'Remaining'}
                </div>
            </div>
        `;
        
        container.appendChild(item);
    });
}

// Transactions
async function loadTransactions() {
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUserId}/transactions?limit=20`);
        if (!response.ok) throw new Error('Failed to load transactions');
        
        const transactions = await response.json();
        updateTransactionsList(transactions);
    } catch (error) {
        console.error('Error loading transactions:', error);
    }
}

function updateTransactionsList(transactions) {
    const container = document.getElementById('transactionsList');
    
    if (transactions.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-receipt"></i>
                <p>No transactions yet. Upload a receipt to get started!</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = transactions.map(txn => `
        <div class="transaction-item">
            <div class="transaction-info">
                <h3 class="transaction-merchant">${txn.merchant || 'Unknown Merchant'}</h3>
                <div class="transaction-details">
                    <span class="transaction-category-badge">${txn.category}</span>
                    <span>${formatDate(txn.transaction_date)}</span>
                    ${txn.description ? `<span>${txn.description}</span>` : ''}
                </div>
            </div>
            <div class="transaction-amount">${formatCurrency(txn.amount)}</div>
        </div>
    `).join('');
}

async function handleAddTransaction(e) {
    e.preventDefault();
    
    const amount = parseFloat(document.getElementById('txnAmount').value);
    const merchant = document.getElementById('txnMerchant').value;
    const category = document.getElementById('txnCategory').value;
    const description = document.getElementById('txnDescription').value;
    
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUserId}/transactions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount,
                merchant: merchant || null,
                category,
                description: description || null,
            }),
        });
        
        if (!response.ok) throw new Error('Failed to add transaction');
        
        hideModal('transactionModal');
        document.getElementById('transactionForm').reset();
        await loadDashboard();
    } catch (error) {
        alert('Error adding transaction: ' + error.message);
    }
}

async function loadCategories() {
    try {
        const response = await fetch(`${API_BASE_URL}/categories`);
        if (!response.ok) throw new Error('Failed to load categories');
        
        const data = await response.json();
        const select = document.getElementById('txnCategory');
        select.innerHTML = data.categories.map(cat => 
            `<option value="${cat}">${cat}</option>`
        ).join('');
    } catch (error) {
        console.error('Error loading categories:', error);
    }
}

// Receipt Upload
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--color-primary)';
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--color-border)';
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFile(files[0]);
    }
}

function handleFileSelect(e) {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
}

let selectedFile = null;

function handleFile(file) {
    if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
    }
    
    selectedFile = file;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        document.getElementById('previewImage').src = e.target.result;
        document.getElementById('uploadArea').style.display = 'none';
        document.getElementById('uploadPreview').style.display = 'block';
    };
    reader.readAsDataURL(file);
}

async function processReceipt() {
    if (!selectedFile) {
        alert('Please select a receipt image');
        return;
    }
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    
    document.getElementById('uploadProgress').style.display = 'block';
    document.getElementById('processReceiptBtn').disabled = true;
    
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUserId}/receipts/upload`, {
            method: 'POST',
            body: formData,
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to process receipt');
        }
        
        const result = await response.json();
        
        // Reset upload UI
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('uploadPreview').style.display = 'none';
        document.getElementById('uploadArea').style.display = 'block';
        document.getElementById('processReceiptBtn').disabled = false;
        document.getElementById('receiptFile').value = '';
        selectedFile = null;
        
        hideModal('receiptModal');
        await loadDashboard();
        
        alert('Receipt processed successfully!');
    } catch (error) {
        document.getElementById('uploadProgress').style.display = 'none';
        document.getElementById('processReceiptBtn').disabled = false;
        alert('Error processing receipt: ' + error.message);
    }
}

// Recommendations
async function loadRecommendations() {
    const content = document.getElementById('recommendationsContent');
    content.innerHTML = '<p>Loading recommendations...</p>';
    
    try {
        const response = await fetch(`${API_BASE_URL}/users/${currentUserId}/recommendations`);
        if (!response.ok) throw new Error('Failed to load recommendations');
        
        const data = await response.json();
        
        if (data.recommendations && data.recommendations.length > 0) {
            content.innerHTML = `
                ${data.recommendations.map(rec => `
                    <div class="recommendation-item">
                        <div class="recommendation-category">${rec.category}</div>
                        <div class="recommendation-details">
                            <span class="recommendation-amount">
                                Current: ${formatCurrency(rec.current_amount)}
                            </span>
                            <span class="recommendation-amount">
                                Recommended: ${formatCurrency(rec.recommended_amount)}
                            </span>
                        </div>
                        <div class="recommendation-reasoning">${rec.reasoning}</div>
                    </div>
                `).join('')}
                ${data.summary ? `<div class="recommendation-summary">${data.summary}</div>` : ''}
            `;
        } else {
            content.innerHTML = '<p>No recommendations available at this time.</p>';
        }
    } catch (error) {
        content.innerHTML = `<p>Error loading recommendations: ${error.message}</p>`;
    }
}

// Utility Functions
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('active');
    }
}

function hideModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('active');
    }
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

