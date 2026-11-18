# Fills the empty msgstr of i18n/es.po from a table: python3 -I scripts/fill-es.py (then npm run i18n).
# Add the Spanish of new texts to ES and run it; texts no longer used can stay in the .po.
import re, sys, os

ES = {
    "(on account)": "(a cuenta)",
    "A payment of the balance, today: change what isn't so": "Un pago del saldo, hoy: cambiá lo que no sea así",
    "Add a budget item...": "Agregar un ítem del presupuesto...",
    "Amount &1 &2 · done &3 % · certified &1 &4 · paid &1 &5 · balance &1 &6": "Monto &1 &2 · hecho &3 % · certificado &1 &4 · pagado &1 &5 · saldo &1 &6",
    "Base month": "Mes base",
    "Budget: &1": "Presupuesto: &1",
    "Certificate &1, &2": "Certificado &1, &2",
    "Expires": "Vence",
    "New contract with...": "Nuevo contrato con...",
    "No contracts yet: choose a contractor and make one.": "Todavía no hay contratos: elegí un contratista y hacé uno.",
    "Shared by all the projects of the company. Red: a document expired or expiring within 15 days.": "Compartidos por todos los proyectos de la empresa. En rojo: un documento vencido o que vence en 15 días.",
    "There are no contractors yet: add them with Contractors... (they are the company's, shared by all the projects).": "Todavía no hay contratistas: agregalos con Contratistas... (son de la empresa, compartidos por todos los proyectos).",
    "What no contract takes yet of the item, at the budget's unit price": "Lo que ningún contrato toma todavía del ítem, al precio unitario del presupuesto",
    "draft: issue it": "borrador: emitirlo",
    "issued: back to draft": "emitido: volver a borrador",
    "Gantt: durations from the labor hours": "Gantt: duraciones según las horas de mano de obra",
    "Investment curve": "Curva de inversión",
    "The Gantt has a task for each budget item: add items in the Budget tab.": "El Gantt tiene una tarea por cada ítem del presupuesto: agregá ítems en la pestaña Presupuesto.",
    "The crew is 1 person or more.": "La cuadrilla es de 1 persona o más.",
    "Add a resource: search by code or name": "Agregar un insumo: buscar por código o nombre",
    "Add a sub-analysis": "Agregar un subanálisis",
    "Brings resources, analyses and rubros from a CSV library (licita2003 as Tincho converted it). What the project already has with the same code is updated; nothing is removed; it can be undone.": "Trae insumos, análisis y rubros de una biblioteca CSV (licita2003 como la convirtió Tincho). Lo que el proyecto ya tiene con el mismo código se actualiza; no se borra nada; se puede deshacer.",
    "Choose the CSV files...": "Elegir los archivos CSV...",
    "Every unit price is multiplied by it (licita2003's coeficiente interno)": "Todos los precios unitarios se multiplican por él (el coeficiente interno de licita2003)",
    "Import licita2003": "Importar licita2003",
    "New equipment": "Equipo nuevo",
    "New labor": "Mano de obra nueva",
    "New material": "Material nuevo",
    "Nothing has that.": "Nada tiene eso.",
    "Only the first 400: search to find the others.": "Solo los primeros 400: buscá para encontrar los demás.",
    "Only the first 500: search to find the others.": "Solo los primeros 500: buscá para encontrar los demás.",
    "Other files": "Otros archivos",
    "Price = D × &1 = &2 &3 a &4": "Precio = D × &1 = &2 &3 por &4",
    "Remove the calculation": "Quitar el cálculo",
    "This equipment has no cost calculation (its typed price is used).": "Este equipo no tiene cálculo de costo (se usa el precio escrito).",
    "Units made with the equipment hours of the lines: the equipment is divided by it": "Unidades que se hacen con las horas de equipo de las líneas: el equipo se divide por esto",
    "Units made with the labor of the lines (e.g. a crew's day): the labor is divided by it": "Unidades que se hacen con la mano de obra de las líneas (por ejemplo, el día de una cuadrilla): la mano de obra se divide por esto",
    "Use the typed price, not the calculation": "Usar el precio escrito, no el cálculo",
    "Used by &1": "Lo usan &1",
    "What a truck costs a km (freight = this × distance / truck load)": "Lo que cuesta un camión por km (flete = esto × distancia / carga del camión)",
    "What an hour of labor costs besides the wage: a % of it (social charges, presentismo, vacations...) or an amount spread over some hours (a monthly bonus over 176 h, work clothes over a semester...).": "Lo que cuesta una hora de mano de obra además del jornal: un % de él (cargas sociales, presentismo, vacaciones...) o un monto repartido en algunas horas (un bono mensual en 176 h, la ropa de trabajo en un semestre...).",
    "with what was added after the xls": "con lo agregado después del xls",
    "It needs the library, or its files.": "Necesita la biblioteca, o sus archivos.",
    "There is no library &1.": "No hay una biblioteca &1.",
    "uploaded files": "archivos subidos",
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
