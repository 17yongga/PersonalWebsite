'use strict';

// Keep the hero summary synchronized with the authenticated balance.
(() => {
  const credits = document.getElementById('creditsAmount');
  const heroBalance = document.getElementById('heroBalance');
  if (!credits || !heroBalance) return;
  const syncBalance = () => {
    const raw = credits.textContent.replace(/[^0-9.]/g, '');
    if (raw) heroBalance.textContent = `$${Number(raw).toLocaleString()}`;
  };
  syncBalance();
  new MutationObserver(syncBalance).observe(credits, { childList: true, characterData: true, subtree: true });
})();

// Lobby filters are presentation-only and do not alter game availability.
(() => {
  const tabs = [...document.querySelectorAll('.filter-tab')];
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(candidate => candidate.classList.remove('active'));
    tab.classList.add('active');
    const filter = tab.dataset.filter;
    document.querySelectorAll('.lobby-games .game-card').forEach(card => {
      const categories = (card.dataset.categories || '').toLowerCase();
      card.hidden = filter !== 'all' && !categories.includes(filter);
    });
  }));
})();

const secondaryAchievementsButton = document.getElementById('achievementsBtn2');
const achievementsButton = document.getElementById('achievementsBtn');
secondaryAchievementsButton?.addEventListener('click', () => achievementsButton?.click());
