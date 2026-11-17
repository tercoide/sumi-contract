#!/bin/bash
# Keeps the Spanish translation up to date (decided with the user 2026-11-17: Spanish and English, kept current).
#   1. the compiler writes the templates of every class (.lang/*.pot)
#   2. they and runtime.pot (the strings shown with Tr()) are merged into one template
#   3. .lang/es.po takes the new strings (empty) and drops the gone ones
#   4. prints how many are left to translate; gbc3 -t compiles es.po into es.mo
# Run from the project folder: .hidden/i18n/update.sh
set -e
cd "$(dirname "$0")/../.."
gbc3 -a -t . > /dev/null
tmp=$(mktemp -d)
msgcat --use-first .lang/*.pot .hidden/i18n/runtime.pot -o "$tmp/all.pot"
if [ -f .lang/es.po ]; then
    msgmerge --quiet --no-fuzzy-matching --update --backup=none .lang/es.po "$tmp/all.pot"
    msgattrib --no-obsolete -o .lang/es.po .lang/es.po
else
    msginit --no-translator --locale=es --input="$tmp/all.pot" --output-file=.lang/es.po
fi
rm -rf "$tmp"
gbc3 -a -t . > /dev/null
left=$(msgattrib --untranslated .lang/es.po | grep -c '^msgid' || true)
[ "$left" -gt 0 ] && left=$((left - 1))
echo "es.po: $left strings to translate"
