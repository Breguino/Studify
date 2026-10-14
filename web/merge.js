// Unione tra dispositivi (versione web): quando la copia locale «da inviare» e l'archivio online sono cambiati
// tutti e due rispetto all'ultima versione comune (`base`), si unisce esame per esame invece di sovrascrivere.
// - cambiato solo da una parte: vince quella;
// - cambiato da tutte e due: si tiene la versione online e la locale diventa una copia «(da questo dispositivo)»,
//   così non si perde niente e chi studia sceglie quale tenere;
// - nuovo da una parte: si aggiunge; cancellato da una parte e non toccato dall'altra: si cancella.
// Funzione pura, testata (test/merge.test.js).

// Confronto che non dipende dall'ordine dei campi: l'archivio online ricompone ogni esame con i campi in un altro ordine.
const canon = (v) => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, canon(v[k])])) : v);
const same = (a, b) => JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
const byId = (s) => new Map((s?.exams ?? []).map((e) => [e.id, e]));

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
