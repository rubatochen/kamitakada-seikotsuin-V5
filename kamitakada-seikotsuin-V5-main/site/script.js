document.addEventListener("DOMContentLoaded", () => {
  const nav = document.querySelector(".site-nav");
  const menuToggle = document.querySelector(".menu-toggle");
  const backTop = document.getElementById("backToTop");
  const languageSelect = document.getElementById("language");

  menuToggle?.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  document.querySelectorAll(".site-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("open");
      menuToggle?.setAttribute("aria-expanded", "false");
    });
  });

  document.querySelectorAll(".faq-question").forEach((button) => {
    button.addEventListener("click", () => {
      const item = button.closest(".faq-item");
      const shouldOpen = !item.classList.contains("open");
      document.querySelectorAll(".faq-item").forEach((faq) => faq.classList.remove("open"));
      if (shouldOpen) item.classList.add("open");
    });
  });

  window.addEventListener("scroll", () => {
    backTop.style.display = window.scrollY > 360 ? "block" : "none";
  });

  backTop?.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  const sections = [...document.querySelectorAll("main section[id]")];
  const navLinks = [...document.querySelectorAll(".site-nav a")];
  const markActive = () => {
    let current = "";
    sections.forEach((section) => {
      if (window.scrollY >= section.offsetTop - 130) current = section.id;
    });
    navLinks.forEach((link) => {
      link.classList.toggle("active", link.getAttribute("href") === `#${current}`);
    });
  };
  window.addEventListener("scroll", markActive);
  markActive();

  document.querySelectorAll(".gallery-grid img").forEach((img) => {
    img.addEventListener("click", () => window.open(img.src, "_blank", "noopener"));
  });

  if (languageSelect && window.setLanguage && window.getPreferredLanguage) {
    const saved = window.getPreferredLanguage();
    languageSelect.value = saved;
    window.setLanguage(saved);
    languageSelect.addEventListener("change", () => {
      window.setLanguage(languageSelect.value);
      localStorage.setItem("language", languageSelect.value);
    });
  }
});
