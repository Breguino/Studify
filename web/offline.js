// Versione web senza connessione: una copia dello stato resta in questo browser, così si studia anche offline
// (in treno, in aula senza rete). Le modifiche restano in locale, segnate come «da inviare», e partono appena
// l'archivio online risponde di nuovo.
// La copia ricorda anche `base`, l'ultima versione in comune con l'online: se nel frattempo lo stesso account è
// cambiato da un altro dispositivo, le due versioni si uniscono esame per esame (web/merge.js) invece di sovrascriversi.
// Senza una copia locale (primo accesso in questo browser) non si inventa nulla: resta il comportamento di prima.
import { mergeStates } from "./merge.js";

/**
 * `cloud`: il backend online ({ init, write }); `local`: { get(uid), set(uid, record) }, il record è { state, dirty, base };
 * `uid`: funzione asincrona con l'id dell'utente;
 * `notify("offline"|"synced"|"conflict", nomi)`: un avviso per chi studia;
 * `onMerge(state)`: lo stato unito con modifiche arrivate da un altro dispositivo, da mettere al posto di quello in memoria.
 */
export function withLocalCopy({ cloud, local, uid, notify = () => {}, onMerge = () => {} }) {
  let id = null;
  let cloudReady = false; // l'indice online è stato letto: solo allora si può scrivere online senza perdere esami
  let offline = false;
  let seq = 0;
  let pending = null; // ultimo stato non ancora online
  let base = null; // ultima versione uguale online e qui (sempre una copia: lo stato in memoria cambia sotto i piedi)
  let fresh = null; // stato online appena riletto, da unire prima di scrivere

  const setBase = (s) => (base = s ? structuredClone(s) : null);
  const keep = (state, dirty) => (id ? local.set(id, { state, dirty, base }).catch(() => {}) : Promise.resolve());
  // una sola rilettura dell'indice alla volta, anche se arrivano più salvataggi insieme
  let reading = null;
  const ensureCloud = () => (cloudReady ? Promise.resolve(true) : (reading ??= cloud.init()
    .then((r) => {
      if (r.persistent) fresh = r.state;
      return (cloudReady = !!r.persistent);
    }, () => false)
    .finally(() => (reading = null))));
  const goOffline = () => {
    if (!offline) notify("offline");
    offline = true;
  };

  /** Unisce `state` (di qui) con quello online; avvisa dei conflitti. */
  function merged(state, remote) {
    const m = mergeStates({ base, local: state, remote });
    if (m.conflicts.length) notify("conflict", m.conflicts);
    return m;
  }

  // Prima di scrivere online si rilegge l'indice: senza, un'interruzione lascerebbe online un indice con meno esami.
  // Se l'indice è stato appena riletto (si torna online), prima si uniscono le modifiche fatte altrove.
  /** Prova a mettere online `state`; true se ci è riuscito. */
  async function push(state, n) {
    try {
      if (!(await ensureCloud())) throw new Error("archivio online non raggiungibile");
      if (fresh) {
        const m = merged(state, fresh);
        fresh = null;
        if (m.changed) {
          state = m.state;
          onMerge(structuredClone(state));
        }
      }
      await cloud.write(state);
    } catch {
      goOffline();
      return false;
    }
    setBase(state); // ora online c'è questo
    if (n === seq) { // nessuna modifica più recente nel frattempo: la copia locale è in pari
      pending = null;
      await keep(state, false);
    }
    if (offline) {
      offline = false;
      notify("synced");
    }
    return true;
  }

  return {
    async init() {
      const r = await cloud.init();
      try {
        id = await uid();
      } catch {
        id = null;
      }
      const copy = id ? await local.get(id).catch(() => null) : null;
      if (r.persistent) {
        cloudReady = true;
        if (copy?.dirty && copy.state) { // modifiche rimaste qui dall'ultima volta: si uniscono con l'online
          base = copy.base ?? null;
          const { state } = merged(copy.state, r.state);
          pending = state;
          offline = true; // l'avviso «di nuovo online» arriva quando la scrittura riesce
          await push(state, seq);
          return { state: structuredClone(state), persistent: true };
        }
        setBase(r.state);
        if (r.state) await keep(r.state, false);
        return r;
      }
      if (!copy?.state) return r;
      goOffline();
      base = copy.base ?? (copy.dirty ? null : structuredClone(copy.state));
      if (copy.dirty) pending = copy.state;
      return { state: copy.state, persistent: true };
    },

    /** Prima in locale (subito), poi online; offline la promessa si risolve lo stesso: i dati non sono persi. */
    async write(state) {
      const snap = structuredClone(state);
      const n = ++seq;
      pending = snap;
      await keep(snap, true);
      await push(snap, n);
    },

    /**
     * Subito dopo ogni modifica, prima del salvataggio online (che aspetta un secondo e mezzo): la copia locale
     * segnata «da inviare». Se la pagina si chiude prima, al prossimo accesso init() la manda online.
     */
    stage(state) {
      if (!id) return;
      const n = ++seq; // una scrittura online già partita non segna più in pari la copia
      pending = structuredClone(state);
      return keep(pending, true).then(() => n);
    },

    /** Al ritorno della connessione: invia ciò che è rimasto in locale. */
    async retry() {
      if (pending) await push(pending, seq);
    },

    get offline() {
      return offline;
    },
  };
}
