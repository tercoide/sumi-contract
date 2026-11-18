# Fills the empty msgstr of i18n/es.po from a table: python3 -I scripts/fill-es.py (then npm run i18n).
# Add the Spanish of new texts to ES and run it; texts no longer used can stay in the .po.
import re, sys, os

ES = {
    "&1 items, &2 changes in the log": "&1 ítems, &2 cambios en el registro",
    "A .contract-proj file, from here or from the desktop version": "Un archivo .contract-proj, de acá o de la versión de escritorio",
    "Add an item: search an analysis by code or name": "Agregar un ítem: buscar un análisis por código o nombre",
    "Changed": "Modificado",
    "Download": "Descargar",
    "Language": "Idioma",
    "No analysis has that.": "Ningún análisis tiene eso.",
    "Open a file": "Abrir un archivo",
    "Projects": "Proyectos",
    "Redo what you undid": "Rehacer lo que deshiciste",
    "Rubro &1": "Rubro &1",
    "The .contract-proj file, also for the desktop version": "El archivo .contract-proj, también para la versión de escritorio",
    "The budget has no items yet: add them from the analyses of the Pricing tab, or manual ones.": "El presupuesto todavía no tiene ítems: agregalos desde los análisis de la pestaña Precios, o manuales.",
    "There are no projects yet: make a new one, or open a file.": "Todavía no hay proyectos: hacé uno nuevo o abrí un archivo.",
    "This tab comes next in the web version.": "Esta pestaña viene a continuación en la versión web.",
}

path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "i18n", "es.po")
text = open(path, encoding="utf-8").read()
blocks = text.split("\n\n")
out, filled = [], 0
for b in blocks:
    m = re.match(r'msgid (".*")\nmsgstr ""$', b.strip(), re.S)
    if m:
        import json
        k = json.loads(m.group(1))
        if k in ES:
            b = 'msgid %s\nmsgstr %s' % (json.dumps(k, ensure_ascii=False), json.dumps(ES[k], ensure_ascii=False))
            filled += 1
        elif k == "...&1...":
            continue
    out.append(b)
open(path, "w", encoding="utf-8").write("\n\n".join(out))
print("filled", filled)
