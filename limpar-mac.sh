#!/bin/bash
# limpar-mac.sh — relatório de espaço + limpeza segura
# Uso: ~/scripts/limpar-mac.sh           -> só relatório
#      ~/scripts/limpar-mac.sh --limpar  -> limpa itens seguros

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
MODO="${1:-relatorio}"
DATA_VOL="/System/Volumes/Data"
CHROME_SW="$HOME/Library/Application Support/Google/Chrome/Default/Service Worker/CacheStorage"

MARCA="$HOME/scripts/.ultima-limpeza"

# Modo automático: só roda se a última limpeza tiver 5 dias ou mais
if [ "$2" = "--auto" ] && [ -f "$MARCA" ] && [ -n "$(find "$MARCA" -mtime -5 2>/dev/null)" ]; then
  echo "$(date '+%d/%m/%Y %H:%M') - Última limpeza há menos de 5 dias. Nada a fazer."
  exit 0
fi

livre() { df -k "$DATA_VOL" | awk 'NR==2 {print $4}'; }
tam()   { [ -e "$1" ] && du -sh "$1" 2>/dev/null | cut -f1 || echo "-"; }

ANTES=$(livre)

echo "===== $(date '+%d/%m/%Y %H:%M') ====="
echo "=== Espaço em disco ==="
df -h "$DATA_VOL" | awk 'NR==2 {print "Total: "$2"  Usado: "$3"  Livre: "$4"  ("$5")"}'
echo
echo "=== Candidatos a limpeza ==="
printf "%-40s %s\n" "Caches de apps"             "$(tam ~/Library/Caches)"
printf "%-40s %s\n" "Logs"                       "$(tam ~/Library/Logs)"
printf "%-40s %s\n" "Lixeira"                    "$(tam ~/.Trash)"
printf "%-40s %s\n" "Chrome Service Worker"      "$(tam "$CHROME_SW")"
printf "%-40s %s\n" "Chrome IndexedDB (revisar)" "$(tam ~/Library/Application\ Support/Google/Chrome/Default/IndexedDB)"
printf "%-40s %s\n" "WhatsApp (revisar no app)"  "$(tam ~/Library/Group\ Containers/group.net.whatsapp.WhatsApp.shared)"
printf "%-40s %s\n" "Downloads (revisar)"        "$(tam ~/Downloads)"
echo
echo "=== Arquivos >500MB em Downloads há mais de 60 dias (revisar) ==="
find ~/Downloads -type f -mtime +60 -size +500M -exec du -sh {} + 2>/dev/null | sort -h

if [ "$MODO" != "--limpar" ]; then
  echo
  echo "Modo relatório: nada foi apagado. Rode com --limpar para limpar os itens seguros."
  exit 0
fi

echo
echo "=== Limpando itens seguros ==="
rm -rf ~/Library/Caches/* 2>/dev/null
rm -rf ~/Library/Logs/* 2>/dev/null
find ~/.Trash -mindepth 1 -maxdepth 1 -mtime +7 -exec rm -rf {} + 2>/dev/null

if pgrep -x "Google Chrome" >/dev/null; then
  echo "Chrome aberto: cache do Service Worker NÃO foi limpo."
else
  rm -rf "$CHROME_SW" 2>/dev/null
fi

command -v brew >/dev/null && brew cleanup -s >/dev/null 2>&1 && brew autoremove >/dev/null 2>&1
command -v npm  >/dev/null && npm cache clean --force >/dev/null 2>&1
command -v pip3 >/dev/null && pip3 cache purge >/dev/null 2>&1
tmutil thinlocalsnapshots / 999999999999 4 >/dev/null 2>&1

DEPOIS=$(livre)
GANHO=$(( (DEPOIS - ANTES) / 1024 ))
LIVRE_GB=$(( DEPOIS / 1024 / 1024 ))
echo "Espaço liberado: ~${GANHO} MB | Livre agora: ~${LIVRE_GB} GB"
touch "$MARCA"

osascript -e "display notification \"Liberado ~${GANHO} MB. Livre: ~${LIVRE_GB} GB\" with title \"Limpeza do Mac\"" 2>/dev/null
