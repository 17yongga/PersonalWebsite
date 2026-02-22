// Scroll reveal animations and dynamic effects
document.addEventListener('DOMContentLoaded', function() {
  
  // Intersection Observer for scroll reveals
  const observerOptions = {
    root: null,
    rootMargin: '0px 0px -100px 0px',
    threshold: 0.1
  };

  const scrollObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        // Unobserve after animation to improve performance
        scrollObserver.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Add scroll-reveal class to elements that should animate
  function initScrollReveals() {
    // Hero sections (skip - they have their own animations)
    
    // Cards and sections
    const cards = document.querySelectorAll('.card, .skill-card, .experience-card, .article-card, .hobby-card-v2, .snapshot-card');
    const sections = document.querySelectorAll('.section-header, .project-card, .timeline-item');
    
    // Apply scroll reveal to cards with stagger delays
    cards.forEach((card, index) => {
      card.classList.add('scroll-reveal');
      if (index < 6) {
        card.classList.add(`delay-${Math.min(index + 1, 6)}`);
      }
      scrollObserver.observe(card);
    });

    // Apply scroll reveal to sections
    sections.forEach((section, index) => {
      section.classList.add('scroll-reveal');
      if (index < 6) {
        section.classList.add(`delay-${Math.min(index + 1, 6)}`);
      }
      scrollObserver.observe(section);
    });

    // Special handling for timeline items
    const timelineItems = document.querySelectorAll('.timeline-item');
    timelineItems.forEach((item, index) => {
      item.classList.add('scroll-reveal');
      item.classList.add(`delay-${Math.min(index + 1, 6)}`);
      scrollObserver.observe(item);
    });

    // Special handling for project cards
    const projectCards = document.querySelectorAll('.project-card');
    projectCards.forEach((card, index) => {
      card.classList.add('scroll-reveal');
      card.classList.add(`delay-${Math.min(index + 1, 4)}`);
      scrollObserver.observe(card);
    });
  }

  // Initialize scroll reveals
  initScrollReveals();

  // Mobile menu animations are handled by main.js
  // This comment replaces the duplicate mobile menu toggle code that was conflicting

  // Enhanced button feedback
  const buttons = document.querySelectorAll('.btn, .send-button, .conversation-starter');
  buttons.forEach(button => {
    button.addEventListener('mousedown', () => {
      button.style.transform = 'scale(0.95)';
    });

    button.addEventListener('mouseup', () => {
      button.style.transform = '';
    });

    button.addEventListener('mouseleave', () => {
      button.style.transform = '';
    });
  });

  // Parallax effect for hero elements
  function initParallax() {
    const heroElements = document.querySelectorAll('.hero-panel, .hero-agent-callout');
    
    window.addEventListener('scroll', () => {
      const scrolled = window.pageYOffset;
      const rate = scrolled * -0.3;
      
      heroElements.forEach(element => {
        if (scrolled < window.innerHeight) {
          element.style.transform = `translateY(${rate}px)`;
        }
      });
    });
  }

  // Only init parallax on non-mobile devices for performance
  if (window.innerWidth > 768 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    initParallax();
  }

  // Reading progress bar for blog posts
  const progressBar = document.querySelector('.reading-progress-bar');
  if (progressBar) {
    window.addEventListener('scroll', () => {
      const scrollTop = window.pageYOffset;
      const docHeight = document.body.scrollHeight - window.innerHeight;
      const scrollPercent = (scrollTop / docHeight) * 100;
      progressBar.style.width = `${Math.min(scrollPercent, 100)}%`;
    });
  }

  // Smooth scroll for anchor links
  const anchorLinks = document.querySelectorAll('a[href^="#"]');
  anchorLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      const targetId = link.getAttribute('href');
      const targetElement = document.querySelector(targetId);
      
      if (targetElement) {
        e.preventDefault();
        targetElement.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });

  // Theme transition smoothing
  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.style.transition = 'background 0.3s ease, color 0.3s ease';
      setTimeout(() => {
        document.body.style.transition = '';
      }, 300);
    });
  }

  // Typewriter effect for special text elements
  function initTypewriter() {
    const typewriterElements = document.querySelectorAll('.typewriter-text');
    
    typewriterElements.forEach(element => {
      const text = element.textContent;
      element.textContent = '';
      element.style.borderRight = '2px solid var(--color-primary)';
      
      let i = 0;
      const timer = setInterval(() => {
        element.textContent += text[i];
        i++;
        
        if (i === text.length) {
          clearInterval(timer);
          // Keep cursor blinking
          setInterval(() => {
            element.style.borderColor = element.style.borderColor === 'transparent' 
              ? 'var(--color-primary)' 
              : 'transparent';
          }, 750);
        }
      }, 100);
    });
  }

  // Initialize typewriter effect
  initTypewriter();

  // Skill bar animations on scroll
  const skillBars = document.querySelectorAll('.skill-bar');
  if (skillBars.length > 0) {
    const skillObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate');
          skillObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.5 });

    skillBars.forEach(bar => {
      skillObserver.observe(bar);
    });
  }

  // Lazy loading for images
  const lazyImages = document.querySelectorAll('img[data-src]');
  if (lazyImages.length > 0) {
    const imageObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          img.src = img.dataset.src;
          img.classList.remove('lazy');
          imageObserver.unobserve(img);
        }
      });
    });

    lazyImages.forEach(img => {
      imageObserver.observe(img);
    });
  }

  // Debug: Log when animations are ready
  console.log('🎬 Animations initialized');
});

// Export for other scripts to use
window.ScrollAnimations = {
  // Function to manually trigger scroll reveal on dynamic content
  observeElement: function(element) {
    if (element && !element.classList.contains('is-visible')) {
      element.classList.add('scroll-reveal');
      scrollObserver.observe(element);
    }
  }
};