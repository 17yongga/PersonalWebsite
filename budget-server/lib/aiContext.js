const { buildBalanceSnapshot, roundMoney } = require('./balances');

const MAX_MESSAGE_CHARS = 1000;
const MAX_TRANSACTIONS_IN_CONTEXT = 10;

function sanitizeAssistantMessage(message) {
  if (typeof message !== 'string') throw new Error('Message is required');
  const trimmed = message.trim();
  if (!trimmed) throw new Error('Message is required');
  return trimmed.slice(0, MAX_MESSAGE_CHARS);
}

function classifyAssistantIntent(message) {
  const text = sanitizeAssistantMessage(message).toLowerCase();
  if (/balance|owe|owed|settle|settlement|emily|partner|shared/.test(text)) return 'shared_balance';
  if (/why|category|food|dining|grocer|shopping|high|driver|spend on/.test(text)) return 'category_drivers';
  if (/weird|unusual|anomal|duplicate|large|odd|strange/.test(text)) return 'anomalies';
  if (/compare|last month|previous month|trend/.test(text)) return 'comparison';
  return 'monthly_summary';
}

function memberName(member) {
  return member?.name || member?.partner_name || (member?.user_id ? `User ${member.user_id}` : 'Unknown');
}

function stripEmojiPrefix(str) {
  return String(str || '').replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+/gu, '').trim();
}

function formatCurrency(amount) {
  return `$${roundMoney(amount).toFixed(2)}`;
}

function getHouseholdBudget(budgets) {
  return roundMoney((budgets || [])
    .filter((budget) => budget.budget_type === 'personal' && budget.user_id != null)
    .reduce((sum, budget) => sum + Number(budget.amount || 0), 0));
}

function getCategoryDrivers(expenses, totalSpent) {
  const byCategory = new Map();
  for (const expense of expenses || []) {
    const category = expense.category || 'Uncategorized';
    byCategory.set(category, roundMoney((byCategory.get(category) || 0) + Number(expense.amount || 0)));
  }
  return Array.from(byCategory.entries())
    .map(([category, amount]) => ({
      category,
      label: stripEmojiPrefix(category) || category,
      amount: roundMoney(amount),
      percent: totalSpent > 0 ? roundMoney((amount / totalSpent) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);
}

function getSharedBalanceSummary({ members, expenses, settlements, userId }) {
  const snapshot = buildBalanceSnapshot({ members, expenses, settlements });
  const suggestion = snapshot.suggested_settlements.find((item) =>
    Number(item.from_user_id) === Number(userId) || Number(item.to_user_id) === Number(userId)
  ) || snapshot.suggested_settlements[0];

  if (!suggestion) {
    return {
      summary: 'Shared expenses are balanced',
      balances: snapshot.balances,
      suggestedSettlements: [],
    };
  }

  const userIsDebtor = Number(suggestion.from_user_id) === Number(userId);
  const userIsCreditor = Number(suggestion.to_user_id) === Number(userId);
  const fromName = userIsDebtor ? 'You' : suggestion.from_name;
  const verb = userIsDebtor ? 'owe' : 'owes';
  const toName = userIsCreditor ? 'you' : suggestion.to_name;
  return {
    summary: `${fromName} ${verb} ${toName} ${formatCurrency(suggestion.amount)}`,
    balances: snapshot.balances,
    suggestedSettlements: snapshot.suggested_settlements,
  };
}

function getRecentTransactions(expenses) {
  return (expenses || [])
    .slice()
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || Number(b.id || 0) - Number(a.id || 0))
    .slice(0, MAX_TRANSACTIONS_IN_CONTEXT)
    .map((expense) => ({
      id: Number(expense.id),
      date: expense.date,
      amount: roundMoney(expense.amount),
      category: expense.category,
      paidBy: expense.paid_by_name || `User ${expense.paid_by}`,
      shared: Number(expense.is_shared) === 1,
      notes: expense.notes || '',
    }));
}

function getAnomalies(expenses) {
  const amounts = (expenses || []).map((expense) => Number(expense.amount || 0)).filter((amount) => amount > 0);
  if (!amounts.length) return [];
  const average = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  return (expenses || [])
    .filter((expense) => Number(expense.amount || 0) >= Math.max(average * 1.8, 100))
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    .slice(0, 5)
    .map((expense) => ({
      id: Number(expense.id),
      amount: roundMoney(expense.amount),
      category: expense.category,
      notes: expense.notes || '',
      reason: `Higher than typical ${formatCurrency(average)} transaction`,
    }));
}

function buildActionPlan({ categoryDrivers = [], budget = {}, anomalies = [], sharedBalance = {} }) {
  const actions = [];
  const topCategory = categoryDrivers[0];

  if (topCategory && Number(topCategory.amount || 0) > 0) {
    const targetReduction = roundMoney(Math.max(10, Number(topCategory.amount || 0) * 0.15));
    actions.push({
      id: 'reduce-top-category',
      type: 'reduce_category_spend',
      title: `Trim ${topCategory.label || topCategory.category}`,
      description: `Try cutting about ${formatCurrency(targetReduction)} from ${topCategory.label || topCategory.category} before month end.`,
      category: topCategory.category,
      estimatedImpact: targetReduction,
      requiresConfirmation: true,
    });
  }

  if (budget.remaining != null && Number(budget.remaining) < 0) {
    actions.push({
      id: 'recover-over-budget',
      type: 'budget_recovery',
      title: 'Recover the over-budget month',
      description: `You are ${formatCurrency(Math.abs(Number(budget.remaining)))} over budget. Pause non-essential spending first.`,
      estimatedImpact: roundMoney(Math.abs(Number(budget.remaining))),
      requiresConfirmation: true,
    });
  } else if (budget.remaining != null) {
    actions.push({
      id: 'protect-remaining-budget',
      type: 'budget_guardrail',
      title: 'Protect remaining budget',
      description: `You have ${formatCurrency(Math.max(0, Number(budget.remaining)))} left. Keep daily discretionary spend below that runway.`,
      estimatedImpact: roundMoney(Math.max(0, Number(budget.remaining))),
      requiresConfirmation: true,
    });
  }

  if ((anomalies || []).length > 0) {
    actions.push({
      id: 'review-unusual-spending',
      type: 'review_transactions',
      title: 'Review unusual transactions',
      description: `Check ${Math.min(anomalies.length, 3)} unusually large transaction${anomalies.length === 1 ? '' : 's'} before making budget changes.`,
      requiresConfirmation: true,
    });
  }

  if ((sharedBalance.suggestedSettlements || []).length > 0) {
    actions.push({
      id: 'settle-shared-balance',
      type: 'settlement_prompt',
      title: 'Settle outstanding shared balance',
      description: sharedBalance.summary,
      requiresConfirmation: true,
    });
  }

  return {
    mode: 'proposal_only',
    disclaimer: 'These are suggestions only. Flowt Assistant will not change budgets, transactions, or settlements without explicit confirmation.',
    actions: actions.slice(0, 4),
  };
}

function buildAssistantContextFromRows({
  userId,
  userName,
  householdId,
  householdName,
  month,
  message,
  members = [],
  expenses = [],
  budgets = [],
  settlements = [],
}) {
  const sanitizedMessage = sanitizeAssistantMessage(message);
  const totalSpent = roundMoney(expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
  const sharedSpent = roundMoney(expenses.filter((expense) => Number(expense.is_shared) === 1).reduce((sum, expense) => sum + Number(expense.amount || 0), 0));
  const personalSpent = roundMoney(totalSpent - sharedSpent);
  const householdBudget = getHouseholdBudget(budgets);
  const categoryDrivers = getCategoryDrivers(expenses, totalSpent);
  const budget = {
    householdBudget,
    usedPercent: householdBudget > 0 ? roundMoney((totalSpent / householdBudget) * 100) : null,
    remaining: householdBudget > 0 ? roundMoney(householdBudget - totalSpent) : null,
  };
  const sharedBalance = getSharedBalanceSummary({ members, expenses, settlements, userId });
  const anomalies = getAnomalies(expenses);

  return {
    scope: {
      householdId: Number(householdId),
      householdName: householdName || `Household ${householdId}`,
      userId: Number(userId),
      userName: userName || memberName(members.find((member) => Number(member.user_id) === Number(userId))),
      month,
      intent: classifyAssistantIntent(sanitizedMessage),
      assistantPhase: 2,
    },
    monthly: {
      totalSpent,
      sharedSpent,
      personalSpent,
      transactionCount: expenses.length,
    },
    budget,
    categoryDrivers,
    sharedBalance,
    anomalies,
    actionPlan: buildActionPlan({ categoryDrivers, budget, anomalies, sharedBalance }),
    recentTransactions: getRecentTransactions(expenses),
    security: {
      mode: 'read_only',
      allowedActions: 'proposal_only_no_mutations',
      untrustedFields: ['transaction.notes', 'transaction.category', 'transaction.paidBy'],
      dataMinimization: `Capped transaction details at ${MAX_TRANSACTIONS_IN_CONTEXT} rows`,
    },
  };
}

module.exports = {
  MAX_MESSAGE_CHARS,
  MAX_TRANSACTIONS_IN_CONTEXT,
  sanitizeAssistantMessage,
  classifyAssistantIntent,
  buildAssistantContextFromRows,
  buildActionPlan,
};
