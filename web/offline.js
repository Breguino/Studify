// Versione web senza connessione: una copia dello stato resta in questo browser, così si studia anche offline
// (in treno, in aula senza rete). Le modifiche fatte offline restano in locale, segnate come «da inviare»,
// e partono appena l'archivio online risponde di nuovo.
// Se nel frattempo hai modificato lo stesso account da un altro dispositivo, vince questo (l'ultimo che si collega).
// Senza una copia locale (primo accesso in questo browser) non si inventa nulla: resta il comportamento di prima.

/**
 * `cloud`: il backend online ({ init, write }); `local`: { get(uid), set(uid, record) }, il record è { state, dirty };
 * `uid`: funzione asincrona con l'id dell'utente; `notify("offline"|"synced")`: un avviso per chi studia.
 */
export function withLocalCopy({ cloud, local, uid, notify = () => {} }) {
  let id = null;
  let cloudReady = false; // l'indice online è stato letto: solo allora si può scrivere online senza perdere esami
  let offline = false;
  let seq = 0;
  let pending = null; // ultimo stato non ancora online

  const keep = (state, dirty) => (id ? local.set(id, { state, dirty }).catch(() => {}) : Promise.resolve());
  // una sola rilettura dell'indice alla volta, anche se arrivano più salvataggi insieme
  let reading = null;
  const ensureCloud = () => (cloudReady ? Promise.resolve(true) : (reading ??= cloud.init()
    .then((r) => (cloudReady = !!r.persistent), () => false)
    .finally(() => (reading = null))));
  const goOffline = () => {
    if (!offline) notify("offline");
    offline = true;
  };

  // Prima di scrivere online si rilegge l'indice: senza, un'interruzione lascerebbe online un indice con meno esami.
  /** Prova a mettere online `state`; true se ci è riuscito. */
  async function push(state, n) {
    try {
      if (!(await ensureCloud())) throw new Error("archivio online non raggiungibile");
      await cloud.write(state);
    } catch {
      goOffline();
      return false;
    }
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
        if (copy?.dirty && copy.state) { // modifiche fatte offline l'ultima volta: hanno la precedenza
          pending = copy.state;
          offline = true; // l'avviso «di nuovo online» arriva quando la scrittura riesce
          await push(copy.state, seq);
          return { state: copy.state, persistent: true };
        }
        if (r.state) await keep(r.state, false);
        return r;
      }
      if (!copy?.state) return r;
      goOffline();
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
      const snap = pending;
      return keep(snap, true).then(() => n);
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
