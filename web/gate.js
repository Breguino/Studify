// Schermata d'accesso della versione web (accesso, registrazione, password dimenticata, nuova password)
// e finestra «Account» (consumo di Claude, cambio password, uscita, eliminazione dell'account).
import { h, toast } from "../public/js/ui.js";
import { clearLocalFiles } from "./backend.js";
import { rpc } from "./claude.js";

export const TERMS_VERSION = "2026-10-05";
export const PRIVACY_VERSION = "2026-10-06";
const MIN_PASSWORD = 8;

const redirectTo = () => `${location.origin}${location.pathname}`;
const field = (label, input, hint) => h("label", {}, label, input, hint ? h("span", { class: "hint" }, hint) : null);

/** Controlli del modulo di registrazione (puri, testati): elenco di errori in italiano. */
export function signupProblems({ email, password, terms, privacy, adult }) {
  const out = [];
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email ?? "")) out.push("Inserisci un indirizzo email valido.");
  if ((password ?? "").length < MIN_PASSWORD) out.push(`La password deve avere almeno ${MIN_PASSWORD} caratteri.`);
  else if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) out.push("La password deve contenere lettere e numeri.");
  if (!terms) out.push("Per registrarti devi accettare i Termini e condizioni.");
  if (!privacy) out.push("Per registrarti devi dichiarare di aver letto l'Informativa privacy.");
  if (!adult) out.push("Studify è riservato a chi ha almeno 18 anni.");
  return out;
}

/** beforeLeave({ save }): prima di uscire o eliminare l'account (salva le modifiche in sospeso, poi blocca le scritture); { undo } le riattiva. */
/**
 * Anti-spam leggero del modulo di registrazione: campo trappola compilato (le persone non lo vedono) o invio
 * troppo rapido. Non ferma chi chiama direttamente l'API di Supabase: per quello serve un CAPTCHA (README).
 */
export const MIN_FILL_MS = 2000;
export function looksLikeBot({ honeypot = "", elapsedMs = Infinity } = {}) {
  return honeypot.trim() !== "" || elapsedMs < MIN_FILL_MS;
}

/**
 * Schermata d'accesso iniziale: quella chiesta dalla landing (?entra=registrati|accedi), altrimenti «Accedi»
 * per chi è già entrato da questo browser e «Registrati» per chi arriva la prima volta.
 */
export function initialMode({ search = "", returning = false } = {}) {
  const wanted = new URLSearchParams(search).get("entra");
  if (wanted === "registrati") return "signup";
  if (wanted === "accedi") return "login";
  return returning ? "login" : "signup";
}

export function createGate({ auth, url, key, beforeLeave = async () => {} }) {
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));
  let overlay = null;
  let userId = auth.user?.id ?? null;

  const setInert = (on) => {
    for (const el of document.querySelectorAll("body > header, body > main, body > footer")) el.inert = on;
  };

  function close() {
    overlay?.remove();
    overlay = null;
    setInert(false);
  }

  function show(mode = "login", { notice = "", email = "" } = {}) {
    overlay?.remove();
    const status = h("div", { class: "auth-status", role: "status", "aria-live": "polite" });
    const say = (msg, kind = "bad") => {
      status.replaceChildren(msg ? h("div", { class: `callout ${kind}` }, msg) : "");
    };
    const busy = (form, on) => {
      for (const b of form.querySelectorAll("button, input")) b.disabled = on;
    };
    const emailInput = () => h("input", { type: "email", name: "email", autocomplete: "email", required: true, value: email, inputmode: "email" });
    const pwd = (autocomplete) => h("input", { type: "password", name: "password", autocomplete, required: true, minlength: MIN_PASSWORD });

    let body;
    if (mode === "login") {
      const form = h("form", { class: "stack", novalidate: true }, field("Email", emailInput()), field("Password", pwd("current-password")),
        h("button", { class: "btn primary", type: "submit" }, "Accedi"),
        h("button", { class: "btn ghost small", type: "button", onclick: () => show("recover", { email: form.email.value }) }, "Password dimenticata?"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        busy(form, true);
        try {
          await auth.signIn({ email: form.email.value.trim(), password: form.password.value });
          await signedIn();
        } catch (err) {
          say(err.message);
          busy(form, false);
        }
      });
      body = form;
    } else if (mode === "signup") {
      const box = (name, ...label) => h("label", { class: "check" }, h("input", { type: "checkbox", name, required: true }), h("span", {}, ...label));
      const shownAt = Date.now();
      const form = h("form", { class: "stack", novalidate: true },
        // campo trappola: fuori dallo schermo, saltato dalla tastiera e dai lettori di schermo; i bot lo compilano
        h("div", { class: "hp", "aria-hidden": "true" }, h("label", {}, "Sito web", h("input", { name: "website", tabindex: "-1", autocomplete: "off" }))),
        field("Email", emailInput()),
        field("Password", pwd("new-password"), `Almeno ${MIN_PASSWORD} caratteri, con lettere e numeri.`),
        h("fieldset", { class: "consents" },
          h("legend", {}, "Per creare l'account"),
          box("terms", "Ho letto e accetto i ", h("a", { href: "termini.html", target: "_blank", rel: "noopener" }, "Termini e condizioni"), "."),
          box("privacy", "Ho letto l'", h("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "Informativa privacy"), ", compreso l'invio dei materiali a Claude (Anthropic, Stati Uniti) per generare i contenuti."),
          box("adult", "Ho almeno 18 anni.")),
        h("button", { class: "btn primary", type: "submit" }, "Crea l'account"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const v = { email: form.email.value.trim(), password: form.password.value, terms: form.terms.checked, privacy: form.privacy.checked, adult: form.adult.checked };
        const problems = signupProblems(v);
        if (problems.length) return say(h("ul", {}, ...problems.map((p) => h("li", {}, p))));
        if (looksLikeBot({ honeypot: form.website.value, elapsedMs: Date.now() - shownAt })) {
          // al bot si risponde come a una persona, senza chiamare Supabase
          return show("login", { email: v.email, notice: `Ti abbiamo mandato un'email a ${v.email}: apri il link per attivare l'account, poi accedi. Non la trovi? Controlla anche nello spam.` });
        }
        busy(form, true);
        try {
          const { confirm } = await auth.signUp({
            email: v.email,
            password: v.password,
            redirectTo: redirectTo(),
            metadata: { terms_version: TERMS_VERSION, privacy_version: PRIVACY_VERSION, adult: true, accepted_at: new Date().toISOString() },
          });
          if (confirm) show("login", { email: v.email, notice: `Ti abbiamo mandato un'email a ${v.email}: apri il link per attivare l'account, poi accedi. Non la trovi? Controlla anche nello spam.` });
          else await signedIn();
        } catch (err) {
          say(err.message);
          busy(form, false);
        }
      });
      body = form;
    } else if (mode === "recover") {
      const form = h("form", { class: "stack", novalidate: true },
        h("p", { class: "muted" }, "Ti mandiamo un link per scegliere una nuova password."),
        field("Email", emailInput()),
        h("button", { class: "btn primary", type: "submit" }, "Invia il link"),
        h("button", { class: "btn ghost small", type: "button", onclick: () => show("login", { email: form.email.value }) }, "Torna all'accesso"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        busy(form, true);
        try {
          await auth.recover({ email: form.email.value.trim(), redirectTo: redirectTo() });
          say("Se l'indirizzo è registrato, riceverai a breve un'email con il link.", "good");
        } catch (err) {
          say(err.message);
        }
        busy(form, false);
      });
      body = form;
    } else {
      // newPassword: dopo il link «password dimenticata»
      const form = h("form", { class: "stack", novalidate: true }, field("Nuova password", pwd("new-password"), `Almeno ${MIN_PASSWORD} caratteri, con lettere e numeri.`),
        h("button", { class: "btn primary", type: "submit" }, "Salva la password"));
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        const p = form.password.value;
        if (p.length < MIN_PASSWORD || !/[a-zA-Z]/.test(p) || !/\d/.test(p)) return say(`Almeno ${MIN_PASSWORD} caratteri, con lettere e numeri.`);
        busy(form, true);
        try {
          await auth.updatePassword(p);
          toast("Password aggiornata.", "ok");
          await signedIn();
        } catch (err) {
          say(err.message);
          busy(form, false);
        }
      });
      body = form;
    }

    const tabs = mode === "login" || mode === "signup"
      ? h("div", { class: "tabs auth-tabs", role: "tablist" },
        h("a", { href: "#", role: "tab", "aria-current": mode === "login" ? "page" : null, "aria-selected": String(mode === "login"), onclick: (e) => (e.preventDefault(), show("login")) }, "Accedi"),
        h("a", { href: "#", role: "tab", "aria-current": mode === "signup" ? "page" : null, "aria-selected": String(mode === "signup"), onclick: (e) => (e.preventDefault(), show("signup")) }, "Registrati"))
      : null;
    const title = { login: "Bentornato", signup: "Crea il tuo account", recover: "Password dimenticata", newPassword: "Scegli una nuova password" }[mode];

    overlay = h("div", { class: "auth-gate", role: "dialog", "aria-modal": "true", "aria-labelledby": "auth-title" },
      h("div", { class: "auth-wrap" },
        h("section", { class: "auth-pitch on-hero" },
          h("div", { class: "logo auth-logo" }, "Studify"),
          h("h1", {}, "Prepara gli esami con i tuoi materiali."),
          h("p", {}, "Appunti, dispense, slide, esami passati e quiz del docente diventano argomenti, flashcard, quiz e un piano di studio giorno per giorno fino all'appello."),
          h("ul", { class: "auth-points" },
            h("li", {}, "Le frasi del docente e le soluzioni ufficiali restano come sono."),
            h("li", {}, "Ripasso distribuito e richiamo attivo, ogni giorno."),
            h("li", {}, "I tuoi esami sincronizzati su tutti i dispositivi."))),
        h("section", { class: "auth-card card" },
          h("h2", { id: "auth-title" }, title),
          tabs,
          notice ? h("div", { class: "callout good" }, notice) : null,
          status,
          body,
          h("p", { class: "small muted auth-legal" }, h("a", { href: "termini.html", target: "_blank", rel: "noopener" }, "Termini e condizioni"), " · ", h("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "Privacy")))));
    document.body.append(overlay);
    setInert(true);
    overlay.querySelector("input")?.focus();
  }

  async function signedIn() {
    const id = auth.user?.id;
    await recordConsent().catch(() => {}); // il consenso è già nei metadati dell'account: la tabella è una copia
    if (userId && id !== userId) {
      // un altro account sullo stesso browser: si ricarica, così non restano dati del precedente in memoria
      await clearLocalFiles();
      location.reload();
      return;
    }
    userId = id;
    try {
      localStorage.setItem("studify-returning", "1"); // dopo l'uscita si propone «Accedi», non «Registrati»
    } catch {
      /* archivio del browser non disponibile */
    }
    close();
    resolveReady();
  }

  async function recordConsent() {
    const m = auth.user?.user_metadata ?? {};
    if (!m.terms_version) return;
    const token = await auth.accessToken();
    await fetch(`${url}/rest/v1/consents?on_conflict=user_id`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ user_id: auth.user.id, terms_version: m.terms_version, privacy_version: m.privacy_version ?? "", adult: !!m.adult, accepted_at: m.accepted_at ?? new Date().toISOString() }),
    });
  }

  /** Avvio: link dall'email (conferma o recupero), sessione salvata, oppure accesso. */
  async function start(initialHash) {
    auth.onChange((s) => {
      if (!s && !overlay) show("login", { notice: "Sessione scaduta: accedi di nuovo." });
    });
    if (initialHash) {
      try {
        const r = await auth.fromHash(initialHash);
        if (r?.type === "recovery") return show("newPassword");
        if (r) {
          toast(r.type === "signup" ? "Email confermata: benvenuto in Studify!" : "Accesso effettuato.", "ok");
          return signedIn();
        }
      } catch (err) {
        return show("login", { notice: "" }), toast(err.message, "error");
      }
    }
    if (auth.session) {
      try {
        if (await auth.accessToken()) return signedIn();
      } catch {
        /* rinnovo fallito: accesso */
      }
    }
    let returning = !!auth.session;
    try {
      returning ||= !!localStorage.getItem("studify-returning");
    } catch {
      /* come sopra */
    }
    show(initialMode({ search: location.search, returning }));
  }

  async function signOut() {
    await beforeLeave({ save: true });
    await clearLocalFiles();
    await auth.signOut();
    location.replace(location.pathname);
  }

  async function account() {
    const previous = document.activeElement;
    let limit = null;
    let spent = null;
    const usage = h("p", { class: "muted" }, "Consumo di Claude: …");
    const onKey = (e) => e.key === "Escape" && done();
    const done = () => (dlg.remove(), document.removeEventListener("keydown", onKey), previous?.focus?.());
    document.addEventListener("keydown", onKey); // anche se il fuoco è uscito dalla finestra
    const passForm = h("form", { class: "row inline-form", hidden: true },
      h("input", { type: "password", name: "password", autocomplete: "new-password", placeholder: "Nuova password", "aria-label": "Nuova password" }),
      h("button", { class: "btn small primary", type: "submit" }, "Salva"));
    passForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const p = passForm.password.value;
      if (p.length < MIN_PASSWORD || !/[a-zA-Z]/.test(p) || !/\d/.test(p)) return toast(`Almeno ${MIN_PASSWORD} caratteri, con lettere e numeri.`, "error");
      try {
        await auth.updatePassword(p);
        passForm.hidden = true;
        passToggle.focus();
        toast("Password aggiornata.", "ok");
      } catch (err) {
        toast(err.message, "error");
      }
    });
    const passToggle = h("button", { class: "btn small", onclick: () => ((passForm.hidden = !passForm.hidden), passForm.hidden || passForm.password.focus()) }, "Cambia password");
    const del = h("div", { class: "stack" },
      h("div", { class: "callout bad" }, "L'eliminazione è definitiva: cancella l'account e tutti gli esami, i moduli e i progressi salvati online. Se vuoi tenerne una copia, prima esporta un backup da «Dati»."),
      h("label", {}, "Scrivi ELIMINA per confermare", h("input", { name: "confirm", autocomplete: "off" })),
      h("button", { class: "btn danger", type: "button", onclick: async () => {
        if (del.querySelector("input").value.trim().toUpperCase() !== "ELIMINA") return toast("Scrivi ELIMINA per confermare.", "error");
        try {
          await beforeLeave({ save: false });
          await rpc({ url, key, auth }, "delete_my_account");
          await clearLocalFiles();
          await auth.signOut().catch(() => {});
          location.replace(`${location.pathname}?eliminato=1`);
        } catch (err) {
          await beforeLeave({ undo: true });
          toast(err.status === 404 ? "L'eliminazione automatica non è ancora attiva: scrivi al gestore (vedi l'Informativa privacy) e l'account sarà eliminato." : "Eliminazione non riuscita. Riprova.", "error");
        }
      } }, "Elimina definitivamente"));
    const dlg = h("div", { class: "modal-backdrop", role: "presentation", onclick: (e) => e.target === dlg && done() },
      h("div", { class: "modal card stack", role: "dialog", "aria-modal": "true", "aria-labelledby": "acct-title" },
        h("div", { class: "row between" }, h("h2", { id: "acct-title", style: { margin: 0 } }, "Account"), h("button", { class: "btn ghost small", onclick: done, "aria-label": "Chiudi" }, "✕")),
        h("p", { style: { margin: 0 } }, h("b", {}, auth.user?.email ?? "")),
        usage,
        h("div", { class: "row" },
          passToggle,
          h("a", { class: "btn small", href: "#/settings", onclick: done }, "Esporta i dati"),
          h("button", { class: "btn small", onclick: signOut }, "Esci")),
        passForm,
        h("p", { class: "small muted", style: { margin: 0 } }, h("a", { href: "termini.html", target: "_blank", rel: "noopener" }, "Termini e condizioni"), " · ", h("a", { href: "privacy.html", target: "_blank", rel: "noopener" }, "Informativa privacy")),
        h("details", {}, h("summary", { class: "small" }, "Elimina l'account"), del)));
    document.body.append(dlg);
    dlg.querySelector("button")?.focus();
    try {
      const [row] = (await rpc({ url, key, auth }, "ai_spend_this_month")) ?? [];
      spent = Number(row?.mine ?? 0);
      limit = (await (await fetch("/api/claude")).json().catch(() => ({})))?.limits?.user ?? null;
      usage.textContent = limit ? `Credito di Claude usato questo mese: ${Math.min(100, Math.round((spent / limit) * 100))}%. Si rinnova il primo del mese.` : `Consumo di Claude questo mese: ${spent.toFixed(2)} $.`;
    } catch {
      usage.textContent = "Consumo di Claude: non disponibile.";
    }
  }

  return { ready, start, show, signOut, account };
}
