// Script delle pagine pubbliche del sito (home, funzionalità, prezzi): li inserisce la build in ogni pagina.
// Senza JavaScript le pagine funzionano lo stesso: tutto è visibile, i passi di «Come funziona» sono uno sotto l'altro.

// Chi ha già una sessione in questo browser vede «Apri Studify» al posto di «Inizia gratis».
try {
  if (localStorage.getItem("studify-session")) {
    for (const el of document.querySelectorAll("[data-guest]")) el.hidden = true;
    for (const el of document.querySelectorAll("[data-member]")) el.hidden = false;
  }
} catch { /* archivio del browser non disponibile: restano i pulsanti per gli ospiti */ }

// Telefono: il pulsante in basso compare quando quelli in cima sono usciti dallo schermo
// e sparisce davanti all'invito finale e al piè di pagina, per non coprirli.
(() => {
  const bar = document.getElementById("sticky-cta");
  const watched = [".hero-cta", ".cta-band", ".site-footer"].map((q) => document.querySelector(q)).filter(Boolean);
  if (!bar || !("IntersectionObserver" in window) || !watched.length) return;
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) e.isIntersecting ? seen.add(e.target) : seen.delete(e.target);
    bar.hidden = seen.size > 0;
  });
  watched.forEach((el) => io.observe(el));
})();

// Entrata delle sezioni allo scorrimento (CSS in landing.css): si marcano i blocchi sotto la prima schermata,
// e ciascuno compare quando entra in vista. Chi ha chiesto meno movimento li vede subito.
(() => {
  if (!("IntersectionObserver" in window) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const groups = [".section > .kicker, .section > .section-title, .section > .section-lead", ".tour-item", ".bento > *", ".methods > *", ".split > *", ".feature > *", ".faq > details", ".plan-table", ".cta-band"];
  const els = [];
  for (const sel of groups) document.querySelectorAll(sel).forEach((el, i) => { el.style.setProperty("--i", String(Math.min(i, 5))); els.push(el); });
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const el of els) {
    if (el.getBoundingClientRect().top < innerHeight) continue; // già in vista: resta com'è
    el.dataset.reveal = "";
    io.observe(el);
  }
  document.documentElement.classList.add("reveal");
})();

// «Come funziona» su computer: passi a sinistra, l'app a destra (CSS in landing.css, html.tour-on). I passi avanzano da
// soli solo mentre la sezione è in vista, si fermano al passaggio del mouse o del fuoco e per sempre al primo clic.
// Con «movimento ridotto» niente avanzamento e niente animazioni: si sceglie il passo col clic.
(() => {
  const tour = document.querySelector("[data-tour]");
  if (!tour) return;
  const items = [...tour.querySelectorAll(".tour-item")];
  const wide = matchMedia("(min-width: 821px)");
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = 0;
  for (const mock of tour.querySelectorAll(".mock")) [...mock.children].forEach((c, i) => c.style.setProperty("--n", String(i)));
  const show = (i, animate) => {
    current = i;
    items.forEach((it, k) => {
      const on = k === i;
      const head = it.querySelector(".tour-head");
      const panel = it.querySelector(".tour-panel");
      it.classList.toggle("on", on);
      // sul telefono si vedono tutti i passi: niente «aperto/chiuso»
      if (wide.matches) head.setAttribute("aria-expanded", String(on)); else head.removeAttribute("aria-expanded");
      panel.inert = wide.matches && !on;
      panel.classList.remove("play");
      if (on && animate && !still) { void panel.offsetWidth; panel.classList.add("play"); }
    });
  };
  document.documentElement.classList.add("tour-on");
  show(0, false);
  wide.addEventListener?.("change", () => show(current, false));
  items.forEach((it, i) => it.querySelector(".tour-head").addEventListener("click", () => {
    if (!wide.matches) return;
    tour.classList.remove("auto");
    tour.dataset.stopped = "";
    show(i, true);
  }));
  tour.addEventListener("animationend", (e) => {
    if (e.target.classList.contains("tour-bar") && tour.classList.contains("auto")) show((current + 1) % items.length, true);
  });
  if (still || !("IntersectionObserver" in window)) return;
  new IntersectionObserver(([e]) => {
    tour.classList.toggle("auto", e.isIntersecting && !("stopped" in tour.dataset));
  }, { threshold: .35 }).observe(tour);
})();

// Menu del telefono: si chiude scegliendo una voce o con Esc.
(() => {
  const menu = document.querySelector(".site-menu");
  if (!menu) return;
  menu.addEventListener("click", (e) => { if (e.target.closest("a")) menu.open = false; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && menu.open) { menu.open = false; menu.querySelector("summary").focus(); } });
})();
