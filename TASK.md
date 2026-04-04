# Budget App — Follow-up Fixes (4 items)

Working file: `/Users/moltbot/clawd/PersonalWebsite/budget.html`
SSH deploy: `ubuntu@52.86.178.139`

---

## FIX 1: Pie Chart Click — 2-Step (Preview → Details)

Currently `onClick` in `renderCategoryChart()` immediately calls `showCategoryTransactionsModal(label)` which dumps the full transaction list.

**Change the flow:**
1. First click on slice → show a small **preview tooltip/popup** with:
   - Category name (large)
   - Total amount for that category (large)
   - A "📋 View Details" button below
2. Clicking "View Details" → then shows the full transaction list modal (existing `showCategoryTransactionsModal`)

**Implementation:**
- Replace `showCategoryTransactionsModal(label)` in the onClick handler with `showCategoryPreview(label, amount)`
- The `amount` comes from `this.data.datasets[0].data[idx]`
- `showCategoryPreview(categoryName, amount)`:
  - Creates a small centered card (not full modal overlay, just a floating card) that shows:
    ```
    [✕ close button top right]
    🛒 Groceries       ← category name, big
    $284.50            ← total, accent color, very large font
    [📋 View Details]  ← button, full width
    ```
  - Clicking "View Details" calls `showCategoryTransactionsModal(categoryName)` and closes the preview
  - Clicking ✕ closes the preview
  - The preview should be a fixed-position small card centered on screen (not the full dark overlay)
  - Add id="categoryPreviewCard" so it can be removed easily
- Keep `showCategoryTransactionsModal` and `closeCategoryModal` as-is

CSS for preview card:
```css
.category-preview-card {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #1a1a2e;
    border: 1px solid rgba(99,102,241,0.4);
    border-radius: 16px;
    padding: 24px 28px;
    min-width: 220px;
    max-width: 300px;
    z-index: 9000;
    box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    text-align: center;
}
.category-preview-name { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.category-preview-amount { font-size: 36px; font-weight: 800; color: #818cf8; margin-bottom: 20px; }
.category-preview-close { position: absolute; top: 10px; right: 14px; background: none; border: none; color: #a0a0a0; font-size: 18px; cursor: pointer; }
```

---

## FIX 2: Transaction Filter Bar Layout

Current HTML (around line 1840):
```html
<div class="filter-bar glass-card">
    <div class="filter-bar-row">  <!-- search + action buttons -->
    <div class="filter-bar-row">  <!-- filter toggle button -->
    <div class="filter-panel ...">  <!-- collapsible filters -->
```

**Problems:** On mobile the search + 3 buttons (CSV, Scan, Add) are cramped. The filter button row feels disconnected.

**Desired layout:**
- Row 1: Search bar (full width)
- Row 2: Action buttons (CSV, Scan, Add) on the right + Filter toggle on the left, all in ONE row
  - Left: `🔽 Filters [badge]`  and active filter summary
  - Right: `📥 CSV`, `📷 Scan`, `➕ Add`
- Filter panel below (existing, no change)
- On mobile (<480px): action buttons wrap, Add button is full-width

Updated HTML for the filter bar:
```html
<div class="filter-bar glass-card">
    <!-- Row 1: search -->
    <div class="filter-bar-row">
        <input type="text" class="form-input" id="searchFilter" placeholder="🔍 Search transactions..." oninput="filterTransactions()" style="height:38px;font-size:13px;width:100%;">
    </div>
    <!-- Row 2: filters left, actions right -->
    <div class="filter-bar-row filter-bar-actions-row">
        <div class="filter-bar-left">
            <button class="btn btn-secondary btn-small" id="filterToggleBtn" onclick="toggleFilterPanel()" style="font-size:13px;">
                🔽 Filters <span id="filterBadge" class="filter-badge" style="display:none;">0</span>
            </button>
            <span id="activeFilterSummary" style="font-size:11px;color:var(--text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:140px;"></span>
        </div>
        <div class="filter-bar-right">
            <button class="btn btn-secondary btn-small" onclick="exportTransactions('csv')" title="Export CSV">📥</button>
            <button class="btn btn-secondary btn-small" onclick="openScanModal()" title="Scan receipt">📷</button>
            <button class="btn btn-small btn-add-txn" onclick="openExpenseModal()">➕ Add</button>
        </div>
    </div>
    <!-- Filter panel -->
    <div class="filter-panel glass-card" id="filterPanel" style="display:none;">
        ...keep existing filter chips and clear button...
    </div>
</div>
```

Add CSS:
```css
.filter-bar-actions-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; }
.filter-bar-left { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.filter-bar-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.btn-small { padding: 7px 12px; font-size: 13px; }
.btn-add-txn { background: linear-gradient(135deg, var(--accent-start), var(--accent-end)); color: white; white-space: nowrap; }
@media (max-width: 480px) {
    .filter-bar-right .btn-add-txn { padding: 7px 10px; }
}
```

---

## FIX 3: Analytics Page Mobile Layout

From the screenshot, the issues are:
1. "Spending by Category" chart: legend is wrapping into many rows showing ALL the old duplicate categories — this should be cleaner now after DB fix, but the legend layout is still bad on mobile
2. "Member Split" chart: legend is at TOP, chart below — legend items are wrapping
3. General: charts are too tall/cramped on small screens

**Fixes to Chart.js options in `renderCategoryChart()` and `renderPartnerChart()`:**

For category chart (renderCategoryChart), update the Chart.js options:
```js
options: {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            position: 'bottom',
            labels: {
                color: '#ffffff',
                boxWidth: 10,
                boxHeight: 10,
                padding: 8,
                font: { size: 11 },
                // Limit legend to 2 columns on mobile
                generateLabels: function(chart) {
                    const original = Chart.defaults.plugins.legend.labels.generateLabels(chart);
                    return original;
                }
            }
        },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: $${ctx.parsed.toFixed(2)}` } }
    },
    onClick: ... // keep existing
}
```

For the **chart container divs** in the HTML, find the `<canvas id="categoryChart">` and `<canvas id="partnerChart">` and ensure their wrapper divs have:
```css
height: 260px;  /* on mobile, reduce from likely 300px */
```

Add this to the CSS section:
```css
@media (max-width: 600px) {
    .chart-container { height: 240px !important; }
    .analytics-chart-card canvas { max-height: 220px; }
}
```

For `renderPartnerChart()`, also move legend to bottom:
```js
legend: { position: 'bottom', labels: { color: '#ffffff', boxWidth: 10, padding: 8, font: { size: 11 } } }
```

**Also fix the analytics section padding/spacing on mobile:**
Find the analytics tab content div and add:
```css
@media (max-width: 600px) {
    #analytics .glass-card { padding: 16px 12px; }
    #analytics h3 { font-size: 15px; }
    .analytics-view-btn { font-size: 11px; padding: 5px 10px; }
}
```

---

## Deployment

After all changes:

```bash
cd /Users/moltbot/clawd/PersonalWebsite

# 1. Commit
git add budget.html
git commit -m "fix(budget): pie 2-step preview, filter bar layout, analytics mobile layout"
git push

# 2. S3 + CloudFront
aws s3 cp budget.html s3://gary-yong.com/budget.html --profile clawdbot-deploy
aws cloudfront create-invalidation --distribution-id EUVZ94LCG1QV2 --paths "/budget.html" --profile clawdbot-deploy

# 3. Notify
openclaw system event --text "Done: Budget follow-up fixes deployed (pie 2-step, filter layout, analytics mobile)" --mode now
```

