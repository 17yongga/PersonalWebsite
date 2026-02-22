/* ============================================================
   SCROLL REVEAL — Intersection Observer for animations
   ============================================================ */
(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          // Unobserve after reveal (one-time animation)
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.1,
      rootMargin: '0px 0px -60px 0px',
    }
  );

  // Observe all reveal elements on DOM ready
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.reveal, .reveal-scale, .reveal-left, .reveal-right, .stagger')
      .forEach((el) => observer.observe(el));
  });
})();

/* ============================================================
   NAV SCROLL — Add .scrolled class on scroll
   ============================================================ */
(() => {
  const nav = document.getElementById('nav');
  if (!nav) return;

  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 50);
        ticking = false;
      });
      ticking = true;
    }
  });
})();

/* ============================================================
   MOBILE MENU TOGGLE
   ============================================================ */
(() => {
  const hamburgerBtn = document.getElementById('hamburger-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  
  if (!hamburgerBtn || !mobileMenu) return;

  let isOpen = false;

  const navHeader = document.getElementById('nav');

  function toggleMenu() {
    isOpen = !isOpen;
    hamburgerBtn.classList.toggle('active', isOpen);
    mobileMenu.classList.toggle('active', isOpen);
    if (navHeader) navHeader.classList.toggle('menu-open', isOpen);
    
    // Prevent body scroll when menu is open
    document.body.style.overflow = isOpen ? 'hidden' : '';
  }

  function closeMenu() {
    if (isOpen) {
      isOpen = false;
      hamburgerBtn.classList.remove('active');
      mobileMenu.classList.remove('active');
      if (navHeader) navHeader.classList.remove('menu-open');
      document.body.style.overflow = '';
    }
  }

  // Toggle on hamburger click
  hamburgerBtn.addEventListener('click', toggleMenu);

  // Close on overlay click
  mobileMenu.addEventListener('click', (e) => {
    if (e.target === mobileMenu) {
      closeMenu();
    }
  });

  // Close on menu link click
  document.querySelectorAll('.mobile-nav-link').forEach(link => {
    link.addEventListener('click', closeMenu);
  });

  // Close on escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) {
      closeMenu();
    }
  });

  // Close on window resize (if screen gets bigger)
  window.addEventListener('resize', () => {
    if (window.innerWidth > 768 && isOpen) {
      closeMenu();
    }
  });
})();

/* ============================================================
   SMOOTH SCROLL — for anchor links
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const target = document.querySelector(anchor.getAttribute('href'));
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
});
