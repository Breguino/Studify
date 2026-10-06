// Dal file unico di Parcel + html-inline alla pagina da pubblicare come Artifact: la pubblicazione aggiunge da sé
// doctype, <html>, <head> e <body>, quindi qui restano solo titolo, stile, radice e script.
import { readFileSync, writeFileSync } from "node:fs";

const s = readFileSync(new URL("../dist/bundle.html", import.meta.url), "utf8");
const title = s.match(/<title>(.*?)<\/title>/)[1];
const style = s.match(/<style>([\s\S]*?)<\/style>/)[1];
const open = '<script type="module">';
const script = s.slice(s.indexOf(open) + open.length, s.lastIndexOf("</script>"));
const page = `<title>${title}</title>\n<style>${style}</style>\n<div id="root" lang="it"></div>\n${open}${script}</script>\n`;
writeFileSync(new URL("../dist/studify-demo.html", import.meta.url), page);
console.log(`dist/studify-demo.html: ${Math.round(page.length / 1024)} KB`);
