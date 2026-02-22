/* ============================================================
   HERO BACKGROUND ANIMATION — Floating gradient orbs
   Inspired by opensession.co
   ============================================================ */
(() => {
  const canvas = document.querySelector('.hero-bg-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  let animationId;
  let orbs = [];
  
  // Performance settings
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = window.innerWidth < 768;
  const orbCount = isMobile ? 3 : 5;

  // Resize canvas to match container
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  // Create orb objects
  function createOrbs() {
    orbs = [];
    for (let i = 0; i < orbCount; i++) {
      orbs.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * (isMobile ? 150 : 250) + 100,
        speedX: (Math.random() - 0.5) * (isMobile ? 0.3 : 0.5),
        speedY: (Math.random() - 0.5) * (isMobile ? 0.3 : 0.5),
        opacity: Math.random() * 0.15 + 0.05,
        hue: Math.random() * 60 + 180, // Blue/cyan range
      });
    }
  }

  // Create gradient for orb
  function createOrbGradient(orb) {
    const gradient = ctx.createRadialGradient(
      orb.x, orb.y, 0,
      orb.x, orb.y, orb.size
    );
    
    gradient.addColorStop(0, `hsla(${orb.hue}, 85%, 65%, ${orb.opacity})`);
    gradient.addColorStop(0.4, `hsla(${orb.hue}, 75%, 55%, ${orb.opacity * 0.6})`);
    gradient.addColorStop(1, `hsla(${orb.hue}, 65%, 45%, 0)`);
    
    return gradient;
  }

  // Update orb positions
  function updateOrbs() {
    if (prefersReducedMotion) return; // Respect accessibility

    orbs.forEach(orb => {
      orb.x += orb.speedX;
      orb.y += orb.speedY;

      // Bounce off edges
      if (orb.x <= 0 || orb.x >= canvas.width) orb.speedX *= -1;
      if (orb.y <= 0 || orb.y >= canvas.height) orb.speedY *= -1;

      // Keep within bounds
      orb.x = Math.max(0, Math.min(canvas.width, orb.x));
      orb.y = Math.max(0, Math.min(canvas.height, orb.y));

      // Subtle size/opacity variation
      orb.opacity += (Math.random() - 0.5) * 0.001;
      orb.opacity = Math.max(0.02, Math.min(0.2, orb.opacity));
    });
  }

  // Render frame
  function render() {
    // Clear with blend mode for smoother gradients
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Use lighter blend mode for additive effect
    ctx.globalCompositeOperation = 'lighter';
    
    // Draw each orb
    orbs.forEach(orb => {
      ctx.fillStyle = createOrbGradient(orb);
      ctx.beginPath();
      ctx.arc(orb.x, orb.y, orb.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Animation loop
  function animate() {
    updateOrbs();
    render();
    animationId = requestAnimationFrame(animate);
  }

  // Initialize
  function init() {
    resizeCanvas();
    createOrbs();
    
    if (prefersReducedMotion) {
      // Static render for accessibility
      render();
    } else {
      animate();
    }
  }

  // Handle resize
  window.addEventListener('resize', () => {
    resizeCanvas();
    createOrbs();
  });

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
    }
  });
})();