#!/usr/bin/env bash
# Publica la versión de package.json como GitHub Release. El release nuevo queda como "Latest",
# así que los agentes instalados lo encuentran en
# releases/latest/download/latest.json en su próximo chequeo (≤ 6 h).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(node -p "require('./package.json').version")
TAG="v$VERSION"

for archivo in dist/ComerzioPrintAgent.exe.gz dist/ComerzioPrintAgent-Setup.exe dist/latest.json; do
  [ -f "$archivo" ] || { echo "Falta $archivo: correr npm run build y npm run firmar"; exit 1; }
done

node -e "
const m = require('./dist/latest.json');
if (m.version !== '$VERSION') { console.error('dist/latest.json es de ' + m.version + ', no de $VERSION: correr npm run firmar'); process.exit(1); }
"

if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios sin commitear: el release tiene que corresponder a un commit."
  exit 1
fi

git tag -l "$TAG" | grep -q . || git tag "$TAG"
git push origin HEAD
git push origin "$TAG"

gh release create "$TAG" \
  dist/ComerzioPrintAgent.exe.gz \
  dist/ComerzioPrintAgent-Setup.exe \
  dist/latest.json \
  --title "Agente de impresión $VERSION" \
  --notes "Instalador: ComerzioPrintAgent-Setup.exe. Los agentes ya instalados se actualizan solos." \
  --latest

echo "Publicado $TAG"
