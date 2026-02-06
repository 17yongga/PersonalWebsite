/* ═══════════════════════════════════════════════════════════════
   YongAI — Landing Page Scripts
   Smooth scroll · Reveal animations · Counter · Nav · Form
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── Nav scroll state ───────────────────────────────────────
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const mobileMenu = document.getElementById('mobileMenu');

  let lastScroll = 0;
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    nav.classList.toggle('scrolled', y > 40);
    lastScroll = y;
  }, { passive: true });

  // ── Mobile menu toggle ─────────────────────────────────────
  burger.addEventListener('click', () => {
    burger.classList.toggle('active');
    mobileMenu.classList.toggle('open');
  });

  // Close mobile menu on link click
  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      burger.classList.remove('active');
      mobileMenu.classList.remove('open');
    });
  });

  // ── Smooth scroll for anchor links ─────────────────────────
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      const target = document.querySelector(this.getAttribute('href'));
      if (!target) return;
      e.preventDefault();
      const offset = 80; // nav height buffer
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  // ── Intersection Observer — reveal on scroll ───────────────
  const reveals = document.querySelectorAll('.reveal');

  const observerOptions = {
    threshold: 0.12,
    rootMargin: '0px 0px -40px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target); // animate once
      }
    });
  }, observerOptions);

  reveals.forEach(el => observer.observe(el));

  // ── Animated counters ──────────────────────────────────────
  const counters = document.querySelectorAll('[data-target]');
  let countersAnimated = false;

  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && !countersAnimated) {
        countersAnimated = true;
        animateCounters();
        counterObserver.disconnect();
      }
    });
  }, { threshold: 0.3 });

  counters.forEach(el => counterObserver.observe(el));

  function animateCounters() {
    counters.forEach(counter => {
      const target = +counter.getAttribute('data-target');
      const duration = 1800; // ms
      const start = performance.now();

      function update(now) {
        const elapsed = now - start;
        const progress = Math.min(elapsed / duration, 1);
        // Ease out cubic
        const eased = 1 - Math.pow(1 - progress, 3);
        counter.textContent = Math.round(target * eased);
        if (progress < 1) requestAnimationFrame(update);
      }

      requestAnimationFrame(update);
    });
  }

  // ── Contact form (demo handler) ────────────────────────────
  const form = document.getElementById('contactForm');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      // Collect form data
      const data = new FormData(form);
      const payload = {};
      data.forEach((value, key) => { payload[key] = value; });

      // Log for now (replace with actual endpoint)
      console.log('Form submission:', payload);

      // Show success state
      form.innerHTML = `
        <div class="form-success">
          <h3>🎉 You're in.</h3>
          <p>I'll be in touch within 24 hours to schedule your free strategy call.</p>
        </div>
      `;
      form.classList.add('submitted');
    });
  }

  // ── Subtle parallax on hero grid ───────────────────────────
  const heroGrid = document.querySelector('.hero__grid');
  if (heroGrid && window.matchMedia('(min-width: 768px)').matches) {
    window.addEventListener('scroll', () => {
      const y = window.scrollY;
      if (y < window.innerHeight) {
        heroGrid.style.transform = `translateY(${y * 0.15}px)`;
      }
    }, { passive: true });
  }

  // ── Keyboard accessibility for FAQ ─────────────────────────
  document.querySelectorAll('.faq__item summary').forEach(summary => {
    summary.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        summary.click();
      }
    });
  });

})();
