// Client delle API del server locale. Se la pagina è aperta senza server → modalità base.
async function call(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Server non raggiungibile. Avvia Studify con «npm start».");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore ${res.status}`);
  return data;
}

export async function status() {
  try {
    return await call("/api/status");
  } catch {
    return { ai: false, offline: true };
  }
}

/** Avvia un job lungo e ne segue l'avanzamento (chars = caratteri generati finora). */
export async function runJob(path, body, onProgress = () => {}) {
  const { jobId } = await call(path, { method: "POST", body });
  for (;;) {
    await new Promise((r) => setTimeout(r, 1500));
    const job = await call(`/api/jobs/${jobId}`);
    onProgress(job.chars);
    if (job.status === "done") return job.result;
    if (job.status === "error") throw new Error(job.error);
  }
}

export const grade = (body) => call("/api/grade", { method: "POST", body });
