// Unione tra dispositivi: quando questo dispositivo e l'archivio online sono cambiati tutti e due rispetto all'ultima
// versione comune (`base`), si unisce esame per esame invece di sovrascrivere. Serve dopo un periodo senza rete
// (web/offline.js) e quando due dispositivi salvano mentre sono tutti e due online (artifact/backend.js).
// - cambiato solo da una parte: vince quella;
// - cambiato da tutte e due: si uniscono i campi. I progressi (flashcard, quiz, argomenti studiati, attività fatte,
//   minuti del giorno) si uniscono voce per voce; il piano si rifà; se cambia lo stesso altro campo (nome, data,
//   materiali, modulo) si tiene la versione online e la locale diventa una copia «(da questo dispositivo)»,
//   così non si perde niente e chi studia sceglie quale tenere;
// - nuovo da una parte: si aggiunge; cancellato da una parte e non toccato dall'altra: si cancella.
// Funzione pura, testata (test/merge.test.js).

// Confronto che non dipende dall'ordine dei campi: l'archivio online ricompone ogni esame con i campi in un altro ordine.
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const byId = (s) => new Map((s?.exams ?? []).map((e) => [e.id, e]));
const isMap = (v) => !!v && typeof v === "object" && !Array.isArray(v);

/** Stato vuoto: la base quando online non c'era ancora niente (tutto ciò che c'è online è nuovo). */
export const EMPTY_STATE = Object.freeze({ version: 1, exams: [], profile: null });

// progressi: si uniscono voce per voce (una carta ripassata qui, un'altra sul telefono)
const PROGRESS = new Set(["srs", "qstats", "learned", "done", "activity"]);

/** Voce cambiata da tutte e due le parti: per i minuti di attività si sommano gli aumenti, altrimenti vale l'online. */
function mergeMap(b, l, r, add) {
  const out = {};
  for (const k of new Set([...Object.keys(r), ...Object.keys(l)])) {
    const v = same(l[k], b[k]) ? r[k] : same(r[k], b[k]) ? l[k]
      : add && typeof l[k] === "number" && typeof r[k] === "number" ? r[k] + l[k] - (b[k] ?? 0) : r[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Lo stesso esame cambiato da tutte e due le parti: unione campo per campo, o null se cambia lo stesso campo. */
function mergeExam(b = {}, l, r) {
  const out = {};
  for (const k of new Set([...Object.keys(r), ...Object.keys(l)])) {
    let v;
    if (same(l[k], r[k]) || same(l[k], b[k])) v = r[k];
    else if (same(r[k], b[k])) v = l[k];
    else if (k === "plan") v = null; // si ricalcola dai dati uniti
    else if (PROGRESS.has(k) && isMap(l[k]) && isMap(r[k])) v = mergeMap(isMap(b[k]) ? b[k] : {}, l[k], r[k], k === "activity");
    else return null;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** @returns {{ state, conflicts: string[], changed: boolean }} changed = il risultato è diverso dalla copia locale */
export function mergeStates({ base, local, remote, copySuffix = "da questo dispositivo" }) {
  if (!remote) return { state: local, conflicts: [], changed: false };
  if (!base || same(base, remote)) return { state: local, conflicts: [], changed: false }; // online fermo: vale la copia locale
  const B = byId(base);
  const L = byId(local);
  const R = byId(remote);
  const conflicts = [];
  const exams = [];
  const seen = new Set();
  const push = (e) => { if (e && !seen.has(e.id)) { seen.add(e.id); exams.push(e); } };
  // l'ordine segue quello online, poi gli esami nuovi di questo dispositivo
  for (const id of [...R.keys(), ...L.keys()]) {
    if (seen.has(id)) continue;
    const b = B.get(id), l = L.get(id), r = R.get(id);
    const lChanged = !same(l, b), rChanged = !same(r, b);
    if (!lChanged) { push(r); continue; } // qui fermo: vale l'online (anche se cancellato)
    if (!rChanged) { push(l); continue; } // online fermo: vale il locale (anche se cancellato)
    if (same(l, r)) { push(r); continue; } // stessa modifica
    if (!l) { push(r); continue; } // cancellato qui ma modificato online: si tiene l'online
    if (!r) { push(l); continue; } // cancellato online ma modificato qui: si tiene il locale
    const joined = mergeExam(b, l, r);
    if (joined) { push(joined); continue; } // campi diversi (o solo progressi): si tengono tutte e due le modifiche
    push(r);
    const copy = { ...l, id: `${l.id}-${Date.now().toString(36)}`, name: `${l.name} (${copySuffix})` };
    exams.push(copy);
    seen.add(copy.id);
    conflicts.push(l.name);
  }
  const profile = !same(local?.profile, base?.profile) && same(remote?.profile, base?.profile) ? local.profile : remote.profile;
  const state = { ...remote, exams, profile };
  return { state, conflicts, changed: !same(state, local) };
}

// Svuota `target` e ci copia `source`, così chi tiene in mano `target` vede i dati nuovi.
const refill = (target, source) => {
  for (const k of Object.keys(target)) if (!(k in source)) delete target[k];
  return Object.assign(target, source);
};

/**
 * Mette lo stato unito al posto di quello in memoria aggiornando gli oggetti che ci sono già (stesso id), invece di
 * sostituirli: chi ne tiene uno in mano mentre aspetta (una generazione con Claude che dura minuti, una sessione di
 * ripasso) scrive ancora nello stato vero, e il suo lavoro non finisce in un oggetto che nessuno salva più.
 */
export function applyMerged(target, merged) {
  const live = new Map((target.exams ?? []).map((e) => [e.id, e]));
  target.exams = merged.exams.map((m) => {
    const e = live.get(m.id);
    return !e || e === m ? m : refill(e, m);
  });
  const p = target.profile;
  target.profile = p && merged.profile && p !== merged.profile ? refill(p, merged.profile) : merged.profile;
}

/** L'avviso per chi studia quando un esame è diventato due copie. */
export const conflictMessage = (names) => `${names.map((n) => `«${n}»`).join(", ")}: ${names.length === 1 ? "l'hai modificato" : "li hai modificati"} sia qui sia su un altro dispositivo. Ho tenuto la versione online e aggiunto quella di questo dispositivo come copia «(da questo dispositivo)»: tieni quella giusta ed elimina l'altra.`;
