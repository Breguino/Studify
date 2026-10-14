// Il credito di Claude del mese nell'interfaccia (solo dove c'è, cioè la versione web): una riga accanto ai pulsanti
// che usano Claude e un avviso prima delle richieste lunghe quando sta finendo. Logica in ../credit.js.
import { core } from "../core.js";
import { creditState, HEAVY_JOBS } from "../credit.js";
import { confirmDialog, h } from "../ui.js";

let confirmedUntil = 0; // confermato «parti lo stesso»: per un po' non si richiede (una generazione fa più richieste)

/** Prima di una richiesta lunga: credito finito → errore chiaro; quasi finito → conferma. Senza dati decide il server. */
export async function checkCredit(path) {
  if (!core.credit || !HEAVY_JOBS.has(path)) return;
  let st = null;
  try {
    st = creditState(await core.credit());
  } catch {
    return;
  }
  if (!st || st.level === "ok") return;
  if (st.level === "out") throw Object.assign(new Error(st.text), { code: "quota_exceeded" });
  if (Date.now() < confirmedUntil) return;
  if (!(await confirmDialog(`${st.text} Vuoi partire lo stesso?`, { ok: "Parti lo stesso" }))) throw Object.assign(new Error("Operazione annullata."), { code: "cancelled" });
  confirmedUntil = Date.now() + 10 * 60_000;
}

/** Riga «Credito di Claude del mese: 40% usato», riempita appena arriva il dato; null dove il credito non c'è. */
export function creditLine() {
  if (!core.credit) return null;
  const el = h("p", { class: "small muted credit-line", hidden: true, role: "status" });
  core.credit().then((c) => {
    const st = creditState(c);
    if (!st) return;
    el.textContent = st.text;
    el.classList.toggle("low", st.level !== "ok");
    el.hidden = false;
  }).catch(() => {});
  return el;
}
