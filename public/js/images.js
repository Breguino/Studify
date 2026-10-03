// Foto di appunti: raddrizzate secondo l'orientamento della fotocamera, ridotte al massimo che i modelli usano
// (2576 px sul lato lungo: oltre non serve, sotto la scrittura piccola si legge peggio) e convertite in JPEG.
export const MAX_SIDE = 2576;

export const isImage = (file) => /^image\//.test(file.type) || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(file.name);

export async function prepareImage(file, { maxSide = MAX_SIDE, quality = 0.85 } = {}) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(/\.(heic|heif)$/i.test(file.name) || /hei[cf]/.test(file.type)
      ? `«${file.name}»: il formato HEIC dell'iPhone non si apre in questo browser. Condividi la foto come JPEG, oppure sull'iPhone: Impostazioni › Fotocamera › Formati › «Più compatibile».`
      : `«${file.name}»: immagine non leggibile.`);
  }
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; // le PNG trasparenti diventano su sfondo bianco
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) throw new Error(`«${file.name}»: conversione dell'immagine non riuscita.`);
  return { blob, width: w, height: h };
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Ordine naturale dei nomi («IMG_9.jpg» prima di «IMG_10.jpg»): di solito è l'ordine in cui sono state scattate. */
export const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
