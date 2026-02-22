// ============================================
// MAIN.JS - INTERACTIVITY (SHARED ACROSS PAGES)
// ============================================

// 1. THEME TOGGLE WITH LOCAL STORAGE

const themeToggle = document.getElementById("theme-toggle");
const root = document.documentElement;

if (themeToggle) {
  const storedTheme = window.localStorage.getItem("theme");
  if (storedTheme === "light" || storedTheme === "dark") {
    root.setAttribute("data-theme", storedTheme);
  } else if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
    root.setAttribute("data-theme", "dark");
  }

  function updateToggleIcon() {
    const isDark = root.getAttribute("data-theme") === "dark";
    themeToggle.textContent = isDark ? "🌙" : "☀️";
  }

  updateToggleIcon();

  themeToggle.addEventListener("click", () => {
    const current = root.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    window.localStorage.setItem("theme", next);
    updateToggleIcon();
  });
}

// 2. SCROLL-REVEAL ANIMATIONS

const animatedEls = document.querySelectorAll(".animate-fade-up");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    {
      threshold: 0.12,
    }
  );

  animatedEls.forEach((el) => observer.observe(el));
} else {
  // Fallback: show all elements if IntersectionObserver not supported
  animatedEls.forEach((el) => el.classList.add("is-visible"));
}

// ============ Mobile navigation toggle ============

const mobileToggle = document.querySelector(".mobile-menu-toggle");
const mobileNav = document.querySelector(".nav-mobile");

if (mobileToggle && mobileNav) {
  const closeMenu = () => {
    mobileNav.classList.remove("open");
    mobileToggle.classList.remove("is-open");
    mobileToggle.setAttribute("aria-expanded", "false");
  };

  const openMenu = () => {
    mobileNav.classList.add("open");
    mobileToggle.classList.add("is-open");
    mobileToggle.setAttribute("aria-expanded", "true");
  };

  mobileToggle.addEventListener("click", () => {
    const isOpen = mobileNav.classList.contains("open");
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  mobileNav.addEventListener("click", (event) => {
    if (event.target.tagName === "A") {
      closeMenu();
    }
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  // Close menu when clicking outside
  document.addEventListener("click", (event) => {
    const isClickInsideNav = mobileNav.contains(event.target);
    const isClickOnToggle = mobileToggle.contains(event.target);
    
    if (!isClickInsideNav && !isClickOnToggle && mobileNav.classList.contains("open")) {
      closeMenu();
    }
  });
}

// Dynamic copyright year
document.querySelectorAll('[data-i18n="footer.copyright"]').forEach(el => {
  el.textContent = el.textContent.replace(/©\d{4}/, `©${new Date().getFullYear()}`);
});
