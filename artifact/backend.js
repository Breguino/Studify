// Persistenza nella pagina Claude, sulla capability `db`: i dati stanno nello spazio privato
// dell'utente (data/users/<id>/), invisibile agli altri anche se la pagina viene condivisa.
//
// Un documento `db` può pesare al massimo 256 KiB, quindi lo stato è serializzato in testo e spezzato
// in blocchi. Ogni esame occupa due chiavi: `core` (progressi, piano: cambia spesso) e `mod`
// (modulo e materiali: cambia raramente), così rivedere una flashcard riscrive pochi blocchi.
//
// Due dispositivi (o due schede) possono salvare insieme. Per non perdere niente:
// - i blocchi cambiati si scrivono con un nome nuovo, accanto ai vecchi; poi l'indice (`studify-index`) passa ai nuovi
//   in una sola scrittura, e solo dopo si cancellano i vecchi. Un'interruzione lascia l'ultimo stato intero;
// - l'indice ha una revisione (`rev`): si scrive solo se online c'è ancora quella letta o scritta per ultima.
//   Se no un altro dispositivo ha salvato: si rilegge, si uniscono le due versioni (public/js/merge.js) e si riprova.

import { EMPTY_STATE, conflictMessage, mergeStates } from "../public/js/merge.js";
import { toast } from "../public/js/ui.js";

const CHUNK = 90_000; // caratteri per documento: margine ampio sotto 256 KiB anche con accenti ed escape JSON
const INDEX = "studify-index";

/* ----------------------- codifica (pura, testata) ----------------------- */

export function encodeState(state) {
  const out = new Map();
  out.set("meta", JSON.stringify({ version: state.version, order: state.exams.map((e) => e.id) }));
  out.set("profile", JSON.stringify(state.profile ?? null));
  for (const e of state.exams) {
    const { materials, module, ...core } = e;
    out.set(`e.${e.id}.core`, JSON.stringify(core));
    out.set(`e.${e.id}.mod`, JSON.stringify({ module: module ?? null, materials: materials ?? [] }));
  }
  return out;
}

export function decodeState(strings) {
  const meta = JSON.parse(strings.get("meta") ?? "null");
  if (!meta) return null;
  const exams = [];
  for (const id of meta.order) {
    try {
      const core = JSON.parse(strings.get(`e.${id}.core`));
      const mod = JSON.parse(strings.get(`e.${id}.mod`));
      exams.push({ ...core, module: mod.module, materials: mod.materials });
    } catch {
      /* un esame danneggiato (scrittura interrotta) non deve impedire di aprire gli altri */
    }
  }
  return { version: meta.version, exams, profile: JSON.parse(strings.get("profile") ?? "null") };
}

export const split = (str, size = CHUNK) => {
  const parts = [];
  for (let i = 0; i < str.length; i += size) parts.push(str.slice(i, i + size));
  return parts.length ? parts : [""];
};

/* ------------------------------ backend ------------------------------ */

const use = async (name) => {
  try {
    return (await window.claude?.use?.(name)) ?? null;
  } catch {
    return null;
  }
};

/** Un altro dispositivo ha salvato prima: `remote` è lo stato online appena riletto, `base` l'ultimo in comune. */
export class ConflictError extends Error {
  constructor(remote, base) {
    super("Dati modificati da un altro dispositivo");
    this.code = "conflict";
    this.remote = remote;
    this.base = base;
  }
}

// Riferimento ai blocchi di una chiave nell'indice: un numero (formato di prima, blocchi `c_<chiave>_<i>`)
// oppure { n, g }, con g il nome della scrittura (blocchi `c_<chiave>_<g>_<i>`).
const count = (ref) => (typeof ref === "number" ? ref : ref.n);
const docId = (key, ref, i) => (typeof ref === "number" ? `c_${key}_${i}` : `c_${key}_${ref.g}_${i}`);
const revOf = (doc) => (doc.exists ? doc.data().rev ?? 0 : null); // 0: indice del formato di prima, null: nessun indice

/**
 * L'archivio a blocchi su una collezione `db` ({ doc(id): { get, set, delete, swap? } }).
 * `swap(rev, data)`, se c'è, scrive l'indice solo se online la revisione è ancora `rev` (sul sito: una sola richiesta
 * a Supabase); senza, si rilegge l'indice subito prima di scriverlo.
 * `write` lancia ConflictError se un altro dispositivo ha salvato nel frattempo.
 */
export function createCloud(open, { random = () => Math.random().toString(36).slice(2, 8) } = {}) {
  let col = null;
  let known = new Map(); // chiave -> { str, ref } come online, secondo l'ultima lettura o scrittura
  let rev = null; // revisione dell'indice letta o scritta per ultima
  let queue = Promise.resolve();
  const current = () => decodeState(new Map([...known].map(([k, v]) => [k, v.str]))) ?? EMPTY_STATE;

  /** Legge indice e blocchi; se l'indice cambia durante la lettura (un altro dispositivo salva) si rilegge. */
  async function read() {
    for (let attempt = 0; ; attempt++) {
      const idx = await col.doc(INDEX).get();
      const next = new Map();
      if (!idx.exists) return { known: next, rev: null, found: false };
      let missing = false;
      const entries = Object.entries(idx.data().keys ?? {});
      for (let i = 0; i < entries.length; i += 4) {
        await Promise.all(entries.slice(i, i + 4).map(async ([key, ref]) => {
          const parts = await Promise.all(Array.from({ length: count(ref) }, (_, k) => col.doc(docId(key, ref, k)).get()));
          if (parts.every((p) => p.exists)) next.set(key, { str: parts.map((p) => p.data().s).join(""), ref });
          else missing = true;
        }));
      }
      // un blocco che manca anche alla terza lettura è un danno vero (scrittura interrotta del formato di prima)
      if (!missing || attempt >= 2) return { known: next, rev: revOf(idx), found: true };
    }
  }

  async function commit(target) {
    const g = `${(rev ?? 0) + 1}.${random()}`;
    const next = new Map();
    const written = [];
    const stale = [];
    for (const [key, str] of target) {
      const old = known.get(key);
      if (old?.str === str) { next.set(key, old); continue; }
      const parts = split(str);
      const ref = { n: parts.length, g };
      for (let i = 0; i < parts.length; i++) {
        const id = docId(key, ref, i);
        await col.doc(id).set({ s: parts[i] });
        written.push(id);
      }
      next.set(key, { str, ref });
      if (old) stale.push([key, old.ref]);
    }
    for (const [key, old] of known) if (!target.has(key)) stale.push([key, old.ref]);
    if (!written.length && !stale.length) return; // niente di cambiato
    const index = { v: 2, rev: (rev ?? 0) + 1, keys: Object.fromEntries([...next].map(([k, v]) => [k, v.ref])) };
    const doc = col.doc(INDEX);
    let ok;
    if (doc.swap) ok = await doc.swap(rev, index);
    else {
      ok = revOf(await doc.get()) === rev;
      if (ok) await doc.set(index);
    }
    if (!ok) {
      for (const id of written) await col.doc(id).delete().catch(() => {}); // blocchi che nessun indice usa
      throw await reload();
    }
    known = next;
    rev = index.rev;
    // i blocchi del formato di prima restano: una scheda aperta con la versione vecchia dell'app li usa ancora
    for (const [key, ref] of stale) {
      if (typeof ref === "number") continue;
      for (let i = 0; i < count(ref); i++) await col.doc(docId(key, ref, i)).delete().catch(() => {});
    }
  }

  // Ultimo stato online riletto perché cambiato altrove: le scritture fotografate prima vanno unite anche loro.
  let changedOnline = null;
  async function reload() {
    const base = current();
    const r = await read();
    known = r.known;
    rev = r.rev;
    return (changedOnline = new ConflictError(current(), base));
  }

  /** Mette in coda `job`; la coda prosegue anche se un lavoro fallisce. */
  function enqueue(job) {
    const p = queue.then(job);
    queue = p.catch(() => {});
    return p;
  }

  return {
    name: "claude-db",
    debounceMs: 1500,

    async init() {
      col = await open();
      if (!col) return { state: null, persistent: false };
      try {
        const r = await read();
        known = r.known;
        rev = r.rev;
        return { state: r.found ? decodeState(new Map([...known].map(([k, v]) => [k, v.str]))) : null, persistent: true };
      } catch (e) {
        console.error("lettura archivio fallita", e);
        return { state: null, persistent: false };
      }
    },

    /**
     * Scritture in coda, una alla volta: lo stato è fotografato subito, scritto appena possibile.
     * Se nel frattempo lo stato online è stato riletto (cambiato altrove), questa foto non lo conosce: ConflictError.
     */
    write(state) {
      const target = encodeState(state);
      const seen = changedOnline;
      return enqueue(() => {
        if (changedOnline !== seen) throw changedOnline;
        return commit(target);
      });
    },

    /**
     * Un altro dispositivo ha salvato? Allora un ConflictError con lo stato online già riletto, altrimenti null.
     * Per riprendere i dati aggiornati tornando su una scheda rimasta aperta.
     */
    refresh() {
      if (!col) return Promise.resolve(null);
      return enqueue(async () => (revOf(await col.doc(INDEX).get()) === rev ? null : reload())).catch(() => null);
    },
  };
}

/** Archivio della pagina Claude: la collezione privata dell'utente (data/users/<id>/). */
async function openPrivate() {
  const [db, user] = await Promise.all([use("db"), use("user")]);
  let uid = null;
  try {
    uid = await user?.id?.();
  } catch {
    /* nessun id: nessuno spazio privato */
  }
  return db && uid ? db.collection(`data/users/${uid}`) : null;
}

export const cloud = createCloud(openPrivate);

/**
 * Salvataggio che unisce invece di sovrascrivere: se un altro dispositivo ha salvato prima, si uniscono le due
 * versioni, l'app riceve lo stato unito (`onMerge`, che lo mette al posto di quello in memoria) e si riprova.
 * `state` è lo stato vivo dell'app: dopo `onMerge` contiene già l'unione.
 */
export async function writeMerging(store, state, { onMerge, notify = () => {}, tries = 3 } = {}) {
  for (let i = 0; ; i++) {
    try {
      return await store.write(state);
    } catch (e) {
      if (e?.code !== "conflict" || i >= tries) throw e;
      mergeInto(state, e, { onMerge, notify });
    }
  }
}

/** Unisce lo stato vivo con quello online di un ConflictError; true se lo stato è cambiato. */
export function mergeInto(state, conflict, { onMerge, notify = () => {} }) {
  const m = mergeStates({ base: conflict.base, local: state, remote: conflict.remote });
  if (m.conflicts.length) notify(m.conflicts);
  if (m.changed) onMerge(m.state);
  return m.changed;
}

const hooks = {
  onMerge: (state) => dispatchEvent(new CustomEvent("studify:merged", { detail: state })),
  notify: (names) => toast(conflictMessage(names), "info"),
};

export const backend = {
  ...cloud,
  noPersistMessage: "Non riesco ad accedere all'archivio della pagina: i tuoi dati non verranno salvati. Esporta un backup da «Dati».",
  write: (state) => writeMerging(cloud, state, hooks),
  // tornando su una scheda rimasta aperta: i dati salvati intanto da un altro dispositivo, uniti con quelli di qui
  async refresh(state) {
    const c = await cloud.refresh();
    if (c && mergeInto(state, c, hooks)) await writeMerging(cloud, state, hooks).catch(() => {});
  },

  // I PDF non sono supportati in questa versione: i file restano in memoria.
  putFile: (id, data) => (mem.set(id, data), Promise.resolve()),
  getFile: (id) => Promise.resolve(mem.get(id)),
  hasFile: (id) => Promise.resolve(mem.has(id)),
  delFile: (id) => (mem.delete(id), Promise.resolve()),
};
const mem = new Map();
