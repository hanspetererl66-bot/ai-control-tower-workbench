#!/usr/bin/env bash
# Werkbank starten: alles, was vor dem Start der App sinnvoll ist, in einem Aufruf (Linux und macOS).
#
#   scripts/start-werkbank.sh [Optionen]
#
# Ablauf:
#   1. Abstand zu origin/main anzeigen (ändert nichts)
#   2. npm install, nur wenn node_modules fehlt oder package-lock.json neuer ist
#   3. Beispiel-Spaces installieren (npm run install:examples)
#   4. Prognosedienst (services/tabpfn, Port 8808) starten, falls er nicht schon läuft
#   5. App starten (npm run dev: Vite auf 5273 plus Electron); beim Beenden wird alles
#      wieder gestoppt, was dieses Skript gestartet hat
#
# Optionen:
#   --connect       zusätzlich npm run connect:connectors (Goose-Konfiguration, Connectoren neu verbinden)
#   --no-examples   Schritt 3 überspringen
#   --no-forecast   Schritt 4 überspringen (Late payments im Sales-Space geht dann nicht)
#   --no-fetch      Schritt 1 überspringen (kein Netz nötig)
#   -h, --help      diese Hilfe
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONNECT=0; EXAMPLES=1; FORECAST=1; FETCH=1
for arg in "$@"; do
  case "$arg" in
    --connect) CONNECT=1 ;;
    --no-examples) EXAMPLES=0 ;;
    --no-forecast) FORECAST=0 ;;
    --no-fetch) FETCH=0 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unbekannte Option: $arg (Hilfe: --help)" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*"; }
# Lauscht etwas auf dem Port? Vite hängt oft nur an [::1], daher ss (Linux) oder lsof (macOS) statt nur /dev/tcp auf IPv4.
port_open() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk -v p=":$1" '$4 ~ p"$" { f = 1 } END { exit !f }'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null || (exec 3<>"/dev/tcp/::1/$1") 2>/dev/null
  fi
}

STARTED_FORECAST=""
APP_PID=""
cleanup() {
  if [ -n "$APP_PID" ]; then
    # Nur die eigene Prozessgruppe (npm run dev mit Vite und Electron) beenden, nie nach Namen suchen.
    kill -TERM -- "-$APP_PID" 2>/dev/null || kill -TERM "$APP_PID" 2>/dev/null || true
  fi
  if [ -n "$STARTED_FORECAST" ]; then
    echo; echo "Stoppe Prognosedienst (PID $STARTED_FORECAST) ..."
    kill "$STARTED_FORECAST" 2>/dev/null || true
    pkill -P "$STARTED_FORECAST" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# 0. Läuft die App schon?
if port_open 5273; then
  warn "Port 5273 ist belegt: die Werkbank (Vite) läuft vermutlich schon. Erst beenden, dann neu starten."
  exit 1
fi

# 1. Branch und Abstand zu main
step "Stand des Repos"
echo "Branch: $(git branch --show-current)"
if [ "$FETCH" = 1 ]; then
  if git fetch --all --quiet 2>/dev/null; then
    read -r behind ahead < <(git rev-list --left-right --count origin/main...HEAD 2>/dev/null || echo "? ?")
    echo "Abstand zu origin/main: $behind hinter, $ahead voraus"
    [ "$behind" != "0" ] && [ "$behind" != "?" ] && warn "Es gibt neuere Commits auf main (git pull bzw. mergen, wenn gewünscht)."
  else
    warn "git fetch nicht möglich (kein Netz?), Abstand unbekannt."
  fi
fi
[ -n "$(git status --porcelain --untracked-files=no)" ] && warn "Es gibt nicht committete Änderungen."

# 2. Abhängigkeiten
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  step "npm install"
  npm install || { echo "npm install fehlgeschlagen" >&2; exit 1; }
else
  step "Abhängigkeiten sind aktuell (npm install übersprungen)"
fi

# 3. Beispiel-Spaces
if [ "$EXAMPLES" = 1 ]; then
  step "Beispiel-Spaces installieren"
  npm run install:examples || warn "install:examples meldete einen Fehler, ich starte trotzdem."
fi

# 3b. Connectoren (nur auf Wunsch)
if [ "$CONNECT" = 1 ]; then
  step "Connectoren verbinden"
  npm run connect:connectors || warn "connect:connectors meldete einen Fehler, ich starte trotzdem."
fi

# 4. Prognosedienst für Late payments
if [ "$FORECAST" = 1 ]; then
  if port_open 8808; then
    step "Prognosedienst läuft schon (Port 8808)"
  else
    step "Prognosedienst starten (Port 8808)"
    LOG="${TMPDIR:-/tmp}/werkbank-tabpfn.log"
    services/tabpfn/start.sh >"$LOG" 2>&1 &
    STARTED_FORECAST=$!
    for _ in $(seq 1 120); do
      port_open 8808 && break
      kill -0 "$STARTED_FORECAST" 2>/dev/null || { warn "Prognosedienst ist beendet, Log: $LOG"; STARTED_FORECAST=""; break; }
      sleep 2
    done
    if port_open 8808; then
      echo "bereit: $(curl -s -m 3 http://127.0.0.1:8808/health || echo '(Health nicht lesbar)')"
      echo "Log: $LOG"
    else
      warn "Prognosedienst antwortet nicht. Die App startet trotzdem; Late payments geht dann nicht. Log: $LOG"
    fi
  fi
fi

# 5. App
step "App starten (Strg+C beendet alles)"
# Die App bekommt eine eigene Prozessgruppe, damit cleanup nur sie beendet. setsid gibt es unter Linux, nicht unter macOS;
# dort liefert die Job-Steuerung (set -m) dieselbe Gruppe. stdin kommt aus /dev/null: ein Hintergrundjob, der das Terminal liest, wird angehalten.
if command -v setsid >/dev/null 2>&1; then
  setsid npm run dev </dev/null &
else
  set -m
  npm run dev </dev/null &
fi
APP_PID=$!
wait "$APP_PID"
