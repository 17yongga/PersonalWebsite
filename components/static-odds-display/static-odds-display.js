
// Static Odds Display Component JavaScript
class CS2StaticOdds {
  constructor(container) {
    this.container = container;
    this.selectedOption = null;
    this.init();
  }
  
  init() {
    this.bindEvents();
  }
  
  bindEvents() {
    const options = this.container.querySelectorAll('.odds-option');
    options.forEach(option => {
      option.addEventListener('click', (e) => {
        this.selectOption(option);
      });
    });
  }
  
  selectOption(option) {
    // Remove previous selection
    if (this.selectedOption) {
      this.selectedOption.classList.remove('selected');
    }
    
    // Add new selection
    option.classList.add('selected');
    this.selectedOption = option;
    
    // Emit event
    const event = new CustomEvent('oddsSelected', {
      detail: {
        team: option.dataset.team,
        odds: option.querySelector('.cs2-odds-value').textContent
      }
    });
    this.container.dispatchEvent(event);
  }
}

// Auto-initialize static odds components
document.addEventListener('DOMContentLoaded', () => {
  const containers = document.querySelectorAll('.static-odds-container');
  containers.forEach(container => {
    new CS2StaticOdds(container);
  });
});
