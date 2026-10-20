#!/usr/bin/env bash
# Compile l'appli PC (Windows x64) depuis Linux, macOS ou Windows (Git Bash).
# Prérequis : Go 1.22+ ; rsrc (go install github.com/akavel/rsrc@latest)
# Usage : ./build.sh [version]
set -euo pipefail
cd "$(dirname "$0")"
VERSION="${1:-dev}"

rm -rf web && cp -r ../web web                                   # site embarqué dans l'exe
[ -f go.sum ] || go mod tidy                                      # télécharge les dépendances
rsrc -manifest winres/app.manifest -ico winres/app.ico -arch amd64 -o rsrc_windows_amd64.syso
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -ldflags "-H windowsgui -s -w -X main.version=${VERSION}" \
  -o ../dist/WakForge.exe .
echo "OK : dist/WakForge.exe"
