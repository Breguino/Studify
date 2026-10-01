// Persistenza nella pagina Claude, sulla capability `db`: i dati stanno nello spazio privato
// dell'utente (data/users/<id>/), invisibile agli altri anche se la pagina viene condivisa.
//
// Un documento `db` può pesare al massimo 256 KiB, quindi lo stato è serializzato in testo e spezzato
// in blocchi. Ogni esame occupa due chiavi: `core` (progressi, piano: cambia spesso) e `mod`
// (modulo e materiali: cambia raramente), così rivedere una flashcard riscrive pochi blocchi.

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

let col = null;
let known = new Map(); // chiave -> { str, n } ultimo contenuto scritto/letto
let queue = Promise.resolve();
const docId = (key, i) => `c_${key}_${i}`;

async function writeAll(target) {
  const indexDoc = col.doc(INDEX);
  const keys = () => Object.fromEntries([...known].map(([k, v]) => [k, v.n]));
  for (const [key, str] of target) {
    const old = known.get(key);
    if (old?.str === str) continue;
    const parts = split(str);
    for (let i = 0; i < parts.length; i++) await col.doc(docId(key, i)).set({ s: parts[i] });
    for (let i = parts.length; i < (old?.n ?? 0); i++) await col.doc(docId(key, i)).delete();
    known.set(key, { str, n: parts.length });
    await indexDoc.set({ v: 1, keys: keys() }); // indice aggiornato dopo ogni chiave: un'interruzione non lascia metà stato
  }
  for (const [key, old] of [...known]) {
    if (target.has(key)) continue;
    for (let i = 0; i < old.n; i++) await col.doc(docId(key, i)).delete();
    known.delete(key);
    await indexDoc.set({ v: 1, keys: keys() });
  }
}

export const backend = {
  name: "claude-db",
  debounceMs: 1500,
  noPersistMessage: "Non riesco ad accedere all'archivio della pagina: i tuoi dati non verranno salvati. Esporta un backup da «Dati».",

  async init() {
    const [db, user] = await Promise.all([use("db"), use("user")]);
    let uid = null;
    try {
      uid = await user?.id?.();
    } catch {
      /* nessun id: nessuno spazio privato */
    }
    if (!db || !uid) return { state: null, persistent: false };
    col = db.collection(`data/users/${uid}`);
    try {
      const idx = await col.doc(INDEX).get();
      if (!idx.exists) return { state: null, persistent: true };
      const keys = idx.data().keys ?? {};
      const strings = new Map();
      const entries = Object.entries(keys);
      for (let i = 0; i < entries.length; i += 4) {
        await Promise.all(entries.slice(i, i + 4).map(async ([key, n]) => {
          const parts = await Promise.all(Array.from({ length: n }, (_, k) => col.doc(docId(key, k)).get()));
          if (parts.every((p) => p.exists)) {
            const str = parts.map((p) => p.data().s).join("");
            strings.set(key, str);
            known.set(key, { str, n });
          }
        }));
      }
      return { state: decodeState(strings), persistent: true };
    } catch (e) {
      console.error("lettura archivio fallita", e);
      return { state: null, persistent: false };
    }
  },

  /** Scritture in coda, una alla volta: lo stato è fotografato subito, scritto appena possibile. */
  write(state) {
    const target = encodeState(state);
    queue = queue.then(() => writeAll(target));
    return queue.catch((e) => { queue = Promise.resolve(); throw e; });
  },

  // I PDF non sono supportati in questa versione: i file restano in memoria.
  putFile: (id, data) => (mem.set(id, data), Promise.resolve()),
  getFile: (id) => Promise.resolve(mem.get(id)),
  delFile: (id) => (mem.delete(id), Promise.resolve()),
};
const mem = new Map();
