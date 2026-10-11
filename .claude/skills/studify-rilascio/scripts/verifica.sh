#!/usr/bin/env bash
# Prove automatiche e build di Studify, nell'ordine del controllo «test» di GitHub più la pagina Claude di prova.
# Uso: bash .claude/skills/studify-rilascio/scripts/verifica.sh [demo|solo-demo]
#   demo      → anche la demo guidata (pnpm check e pnpm build in demo/)
#   solo-demo → soltanto la demo guidata (per modifiche che toccano solo demo/)
# Si ferma al primo errore. Non sostituisce la prova nel browser.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

if [ "${1:-}" = "solo-demo" ]; then
  printf '\n== Demo guidata (demo/)\n'
  (cd demo && pnpm check && pnpm build | tail -1)
  printf '\n== Tutto a posto. Resta da fare a mano: prova nel browser della demo (computer e 390px, tema scuro).\n'
  exit 0
fi

passo() { printf '\n== %s\n' "$1"; }

passo "Sintassi dei file JavaScript cambiati rispetto a main"
changed=$(git diff --name-only origin/main -- '*.js' '*.mjs' 2>/dev/null || true)
changed="$changed $(git ls-files --others --exclude-standard -- '*.js' '*.mjs')"
n=0
for f in $changed; do
  [ -f "$f" ] || continue
  case "$f" in demo/*|node_modules/*) continue ;; esac
  node --check "$f"; n=$((n + 1))
done
echo "$n file controllati"

passo "Prove automatiche (npm test)"
out=$(mktemp)
if npm test --silent >"$out" 2>&1; then grep -E '^# (tests|pass|fail)' "$out"; rm -f "$out"
else grep -E '^not ok|^# (pass|fail)' "$out" | head -20; echo "npm test: FALLITO (output completo in $out)"; exit 1; fi

passo "Build della pagina Claude (dist/studify.html)"
npm run build:artifact --silent | tail -1

passo "Build della pagina Claude di prova (dist/harness.html)"
npm run build:harness --silent | tail -1

passo "Build del sito web (dist-web/)"
npm run build:web --silent | tail -1
test -f dist-web/404.html && test -f dist-web/index.html && test -f dist-web/app.html || { echo "dist-web incompleta"; exit 1; }

if [ "${1:-}" = "demo" ]; then
  passo "Demo guidata (demo/)"
  (cd demo && pnpm check && pnpm build | tail -1)
fi

passo "Tutto a posto. Restano da fare a mano: prova nel browser (computer e 390px, tema scuro) delle schermate toccate."
