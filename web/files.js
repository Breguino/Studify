// Versione web: PDF e foto anche online, con i piani a pagamento (Supabase Storage, bucket privato «files»).
// Ogni file è un oggetto <id utente>/<id file>; lo spazio del piano lo controlla il database al caricamento
// (supabase/schema.sql, parte 6). Nel browser i file restano in IndexedDB come prima: online c'è una copia, che un
// altro dispositivo scarica la prima volta che serve. Le funzioni pure sono in cima e sono testate (test/files-sync.test.js).

export const MAX_FILE_BYTES = 50 * 1024 * 1024; // limite del bucket: un file più grande resta solo nel browser
export const ORPHAN_AGE_MS = 24 * 3600_000; // un file online che nessun materiale usa si cancella solo dopo un giorno

/** Byte di un file dato in base64 (senza decodificarlo). */
export const base64Bytes = (b64) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);

// Nel browser un file può essere in tre forme: testo base64 (versione con server, PDF dei materiali «pdf»), byte
// (Uint8Array: i PDF della versione web, da cui si estrae il testo) o Blob (le foto degli appunti nella versione web).
/** Byte del file, in qualunque forma, o null se non è un file. */
export function byteSize(data) {
  if (typeof data === "string") return base64Bytes(data);
  if (data instanceof Uint8Array || data instanceof ArrayBuffer) return data.byteLength;
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  return null;
}

const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"]; // gli unici che il bucket accetta
/** Tipo del file dai primi byte: PDF, JPEG, PNG o WebP, altrimenti null. */
export function sniffType(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === "%PDF") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}
const fromBase64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const toBase64 = (buf) => {
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
};
/** Il file da caricare: { body: Blob, type }; errore { code: "type" } se non è PDF né immagine. */
export async function uploadBody(data) {
  let bytes;
  if (typeof data === "string") bytes = fromBase64(data);
  else if (data instanceof Uint8Array) bytes = data;
  else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
  else if (typeof Blob !== "undefined" && data instanceof Blob) {
    const type = TYPES.includes(data.type) ? data.type : sniffType(await data.slice(0, 12).arrayBuffer());
    if (!type) throw { code: "type" };
    return { body: data.type === type ? data : new Blob([data], { type }), type };
  } else throw { code: "type" };
  const type = sniffType(bytes.subarray(0, 12));
  if (!type) throw { code: "type" };
  return { body: new Blob([bytes], { type }), type };
}
/** Il file scaricato nella forma che l'app si aspetta per quell'id ("base64" | "bytes" | "blob"). */
export async function fromDownload(blob, form) {
  if (form === "base64") return toBase64(new Uint8Array(await blob.arrayBuffer()));
  if (form === "bytes") return new Uint8Array(await blob.arrayBuffer());
  return blob;
}

/** File che i materiali usano, con la forma in cui l'app li tiene: Map id → "base64" | "bytes" | "blob". */
export function referencedFiles(state) {
  const ids = new Map();
  for (const e of state?.exams ?? []) for (const m of e.materials ?? []) {
    if (m.kind === "pdf" && m.fileId) ids.set(m.fileId, "base64");
    if (m.pdfFileId) ids.set(m.pdfFileId, "bytes"); // PDF da cui si è estratto il testo (versione web): per «Leggi formule»
    for (const id of m.imageIds ?? []) if (id) ids.set(id, "blob"); // foto degli appunti (Blob o base64: l'app legge tutti e due)
  }
  return ids;
}

/**
 * Che cosa mettere online e che cosa togliere. `remote`: Map id → { size, updatedAt (ms) }; `localSize(id)`: byte del
 * file in questo browser, o null se non c'è. Si carica solo ciò che sta nello spazio rimasto, dal file più piccolo
 * (più file utili a parità di spazio); si toglie ciò che nessun materiale usa da più di un giorno: un file appena
 * caricato da un altro dispositivo può arrivare prima dell'esame che lo usa.
 */
export function planSync({ referenced, remote, localSize, used, quota, now }) {
  const upload = [];
  const remove = [];
  let room = quota - used;
  const candidates = [...referenced.keys()].filter((id) => !remote.has(id))
    .map((id) => ({ id, size: localSize(id) }))
    .filter((f) => f.size != null && f.size <= MAX_FILE_BYTES)
    .sort((a, b) => a.size - b.size);
  for (const f of candidates) {
    if (room <= 0) break; // il database accetta un caricamento finché lo spazio usato è sotto il limite
    upload.push(f.id);
    room -= f.size;
  }
  for (const [id, info] of remote) if (!referenced.has(id) && now - info.updatedAt > ORPHAN_AGE_MS) remove.push(id);
  return { upload, remove };
}

/** «850 KB», «12 MB», «1 GB», «1,5 GB». */
export function bytesLabel(n) {
  const units = [["GB", 1024 ** 3], ["MB", 1024 ** 2], ["KB", 1024]];
  for (const [u, size] of units) if (n >= size) {
    const v = n / size;
    return `${(v >= 10 || Number.isInteger(v) ? Math.round(v) : Math.round(v * 10) / 10).toString().replace(".", ",")} ${u}`;
  }
  return `${n} byte`;
}

/**
 * Archivio online dei file, con il token dell'utente: { usage, list, upload, download, remove, removeAll }.
 * Errori: { code: "quota" | "too_large" | "type" | "offline" | "session_expired" | "server_error" }.
 */
export function createFiles({ url, key, auth, fetchFn = (...a) => fetch(...a), closed = () => false }) {
  const base = `${url}/storage/v1/object`;
  async function call(path, init = {}) {
    const token = await auth.accessToken().catch(() => null);
    if (!token || !auth.user?.id) throw { code: "session_expired" };
    let r;
    try {
      r = await fetchFn(path, { ...init, headers: { apikey: key, Authorization: `Bearer ${token}`, ...init.headers } });
    } catch {
      throw { code: "offline" };
    }
    return r;
  }
  const path = (id) => `${encodeURIComponent(auth.user.id)}/${encodeURIComponent(id)}`;
  const failure = async (r) => {
    const body = await r.json().catch(() => ({}));
    const status = Number(body.statusCode ?? r.status);
    if (status === 413) return { code: "too_large" };
    if (status === 415) return { code: "type" };
    if (status === 401) return { code: "session_expired" };
    if (status === 403 || /row-level security/i.test(body.message ?? "")) return { code: "quota" }; // la sola regola che può dire di no alla propria cartella
    return { code: "server_error", status };
  };

  return {
    /** { used, quota, plan } in byte. */
    async usage() {
      const r = await call(`${url}/rest/v1/rpc/files_usage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!r.ok) throw await failure(r);
      const row = (await r.json())?.[0] ?? {};
      return { used: Number(row.used ?? 0), quota: Number(row.quota ?? 0), plan: row.plan ?? "free" };
    },
    /** Map id → { size, updatedAt } dei file online. */
    async list() {
      const out = new Map();
      for (let offset = 0; ; offset += 1000) {
        const r = await call(`${base}/list/files`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: `${auth.user.id}/`, limit: 1000, offset, sortBy: { column: "name", order: "asc" } }),
        });
        if (!r.ok) throw await failure(r);
        const rows = await r.json();
        for (const o of rows) if (o.id) out.set(o.name, { size: Number(o.metadata?.size ?? 0), updatedAt: Date.parse(o.updated_at ?? o.created_at ?? 0) || 0 });
        if (rows.length < 1000) return out;
      }
    },
    async upload(id, data) {
      if (closed()) return;
      if ((byteSize(data) ?? 0) > MAX_FILE_BYTES) throw { code: "too_large" };
      const { body, type } = await uploadBody(data);
      const r = await call(`${base}/files/${path(id)}`, { method: "POST", headers: { "Content-Type": type, "x-upsert": "true", "cache-control": "3600" }, body });
      if (!r.ok) throw await failure(r);
    },
    /** Il file nella forma `form` (vedi fromDownload), o null se online non c'è. */
    async download(id, form = "blob") {
      const r = await call(`${base}/authenticated/files/${path(id)}`);
      if (!r.ok) { // Storage risponde 400 con statusCode «404» per un file che non c'è
        const e = await failure(r);
        if (e.status === 404) return null;
        throw e;
      }
      return fromDownload(await r.blob(), form);
    },
    async remove(ids) {
      if (closed() || !ids.length) return;
      const r = await call(`${base}/files`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: ids.map((id) => `${auth.user.id}/${id}`) }) });
      if (!r.ok) throw await failure(r);
    },
    /** Tutti i file online dell'utente (prima di eliminare l'account): lancia un errore se non ci riesce. */
    async removeAll() {
      const ids = [...(await this.list()).keys()];
      for (let i = 0; i < ids.length; i += 500) {
        const r = await call(`${base}/files`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefixes: ids.slice(i, i + 500).map((id) => `${auth.user.id}/${id}`) }) });
        if (!r.ok) throw await failure(r);
      }
      if ((await this.list()).size) throw { code: "server_error" };
    },
  };
}

/**
 * Il browser come prima, più la copia online. `remote()`: l'archivio online (createFiles) o null senza accesso;
 * `formOf(id)`: la forma in cui l'app tiene quel file (referencedFiles), per restituire un file scaricato uguale;
 * `local`: { get, put, has, del } di IndexedDB; `notify("quota", usage) | notify("too_large")`: un avviso, una volta
 * sola per sessione. Caricamenti e cancellazioni online vanno uno alla volta e non bloccano mai l'app: se falliscono
 * (senza rete) li recupera `sync(state)`, all'apertura e quando torna la rete.
 */
export function withOnlineFiles({ remote, local, notify = () => {}, now = () => Date.now(), formOf = () => "blob" }) {
  let usage = null; // { used, quota, plan }: l'ultimo letto
  let listed = null; // { at, map }: i file online, riletti al più ogni minuto
  let queue = Promise.resolve();
  const said = new Set();
  const once = (what, arg) => !said.has(what) && (said.add(what), notify(what, arg));
  const serial = (fn) => (queue = queue.then(fn).catch(() => {}));
  const api = async () => {
    try {
      return await remote();
    } catch {
      return null;
    }
  };
  const readUsage = async (f) => (usage = await f.usage().catch(() => usage));
  const readList = async (f, maxAge = 60_000) => {
    if (listed && now() - listed.at < maxAge) return listed.map;
    try {
      listed = { at: now(), map: await f.list() };
      return listed.map;
    } catch {
      return listed?.map ?? null;
    }
  };
  /** Mette online un file. false: non è riuscito e non conviene provare con gli altri (spazio pieno, senza rete). */
  async function push(f, id, data) {
    try {
      await f.upload(id, data);
      const size = byteSize(data) ?? 0;
      listed?.map.set(id, { size, updatedAt: now() });
      if (usage) usage.used += size;
      return true;
    } catch (e) {
      if (e?.code === "quota") {
        await readUsage(f);
        once("quota", usage);
      } else if (e?.code === "too_large") once("too_large");
      return e?.code === "too_large" || e?.code === "type"; // quel file no, gli altri sì
    }
  }

  return {
    async put(id, data) {
      await local.put(id, data);
      if (byteSize(data) == null) return; // non è un file
      serial(async () => {
        const f = await api();
        if (!f || !(await readUsage(f))?.quota) return; // piano senza spazio online: come prima
        if (usage.used >= usage.quota) return once("quota", usage);
        await push(f, id, data);
      });
    },
    async get(id) {
      const here = await local.get(id);
      if (here != null) return here;
      const f = await api();
      if (!f || !(await readList(f))?.has(id)) return here;
      try {
        const data = await f.download(id, formOf(id));
        if (data != null) await local.put(id, data); // la prossima volta c'è già, anche senza rete
        return data ?? here;
      } catch {
        return here;
      }
    },
    async has(id) {
      if (await local.has(id)) return true;
      const f = await api();
      return f ? !!(await readList(f))?.has(id) : false;
    },
    async del(id) {
      await local.del(id);
      serial(async () => {
        const f = await api();
        if (!f || !(await readList(f))?.has(id)) return;
        await f.remove([id]);
        if (usage) usage.used = Math.max(0, usage.used - (listed?.map.get(id)?.size ?? 0));
        listed?.map.delete(id);
      });
    },
    /** Mette online i file dei materiali che online non ci sono e toglie quelli che nessuno usa più. */
    sync(state) {
      return serial(async () => {
        const f = await api();
        if (!f || !state) return;
        const u = await readUsage(f);
        const map = await readList(f, 0);
        if (!u || !map) return;
        const referenced = referencedFiles(state);
        const sizes = new Map();
        if (u.quota > 0) for (const id of referenced.keys()) {
          if (map.has(id)) continue;
          const data = await local.get(id).catch(() => null);
          const size = byteSize(data);
          if (size != null) sizes.set(id, size);
        }
        const { upload, remove } = planSync({ referenced, remote: map, localSize: (id) => sizes.get(id) ?? null, used: u.used, quota: u.quota, now: now() });
        if (u.quota > 0 && sizes.size > upload.length && u.used + upload.reduce((s, id) => s + sizes.get(id), 0) >= u.quota) once("quota", u);
        for (const id of upload) {
          const data = await local.get(id).catch(() => null);
          if (byteSize(data) != null && !(await push(f, id, data))) break;
        }
        if (remove.length) {
          await f.remove(remove).catch(() => {});
          for (const id of remove) map.delete(id);
        }
      });
    },
    /** Spazio online: { used, quota, plan }, riletto. */
    usage: async () => {
      const f = await api();
      return f ? readUsage(f) : null;
    },
    /** L'ultimo spazio letto, senza richieste (per i messaggi). */
    lastUsage: () => usage,
    idle: () => queue,
  };
}
