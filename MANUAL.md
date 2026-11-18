# sumi-contract: how things are done (web version)

The screens are in Spanish, so this manual names buttons as you'll see them ("Presupuesto"), with the
English in parentheses where it helps. Status as of 2026-11-18.

## 1. Starting it

Once, in a terminal:

```
cd ~/sumi-contract/web
npm install
```

Every time:

```
npm start
```

Open http://localhost:8064. Stop it with Ctrl+C. `npm start` builds everything first, so after any
change in the code just stop it and run `npm start` again.

- Your data lives in `web/data/`: one `.contract-proj` file per project in `data/projects/`, and the
  company's files in `data/company/` (contractors, people, the standard price library, the
  company's own data, and its change log). Copy that folder and you have a backup.
- The language is chosen at the top right (Español / English).
- Without Google keys there are no logins: you are the computer's user, with every right.

## 2. Projects

The first page lists the projects.
- **Nuevo** makes a project. It starts with a copy of the company's standard price library.
- **Abrir un archivo** imports a `.contract-proj` from here or from the Gambas version. The Gambas
  company's contractors don't come with it.
- **La empresa** (the company): the company's name, CUIT and address (printed at the foot of every
  PDF), its people and their roles. See section 9.
- A red box warns of contractors' documents (insurance, ART...) that have expired or expire within 15 days.

Inside a project, the top bar has: Deshacer / Rehacer (undo / redo your last change), Descargar
(download the project file), **PDF** (the reports), **Asistente IA** (the AI) and the tabs.

## 3. Proyecto (the project)

Each field is saved when you leave it or press Enter, and every change goes in the history.
- The work, location, client, notes.
- **Plazos** (schedule): start date, working days, days a week, hours a day, holidays. The end date
  is calculated.
- **Definiciones** (from cost to price): general expenses %, profit %, taxes %. These give the
  factor that turns a direct cost into a price.
- **Condiciones de contrato** (contract conditions): advance, retention (fondo de reparo),
  certificate period, adjustment index and base month. New contracts start with these.
- **Equipo del proyecto** (the project's team): extra roles for someone in this project only.
- Professionals.

## 4. Precios (prices)

- **Importar licita2003** brings in the 467 analyses and 395 resources of the licita2003 library
  that ships with the program. It can be undone.
- **Análisis**: search on the left; the sheet on the right shows A materials, B equipment, C labor,
  sub-analyses, yields and totals. Change a quantity in the grid; add lines with the search boxes.
- **Insumos** (resources): materials, labor and equipment.
  - Labor is calculated from the wage plus the labor charges; equipment from its machine
    calculation.
  - A typed price can override the calculation.
  - Loss %, freight, source and date apply to every resource.
- **Cargas sociales** (labor charges) and **Rubros**.
- The update coefficient (inflation) multiplies every price.

## 5. Presupuesto (budget)

- Add an item by searching an analysis, or a manual item (description, unit, unit cost).
- Type quantities the Spanish way ("1.234,5"). ↑ ↓ move an item, × deletes it.
- Items are numbered rubro.order (4.01, 4.02...). An item in orange came from the design and was
  changed by hand.
- **Del diseño** (from the design):
  1. Load a sumi-designer file (`.designer-proj`, saved by a sumi-designer that writes quantities,
     file version 42 or later).
  2. The rows of the design appear. For rows sumi-designer doesn't map, type the analyses here,
     for example `52; 79 x 2`.
  3. **Actualizar el presupuesto** makes or updates the items. Hand changes are kept; rows that
     are gone are marked.

## 6. Gantt

- There is one task per budget item.
- Type the days, crew, predecessors and lag in the grid.
- **Sugerir duraciones** calculates durations from the labor hours.
- Red tasks are the critical path. Rubros fold.
- The investment curve (monthly and accumulated) is at the bottom.

## 7. Contratos (contracts)

1. **Contratistas...** opens the company's contractors and their documents, which have expiry dates.
2. Choose a contractor, then **Contrato nuevo** (new contract). Its conditions come from the
   Project tab and can be changed.
3. **Ítems**: add budget items. A contract can take part of an item at an agreed price, so an item
   can be split among contractors.
4. **Certificados** (certificates):
   - **Este período** makes a progress certificate that starts where the last one ended. Type the
     accumulated quantity measured.
   - Anticipo (advance) and fondo de reparo (retention return) have their own certificates.
   - "borrador: emitirlo" issues a certificate, which then can't change.
   - The **Certificado** button makes its PDF.
5. **Pagos** (payments): add a payment (by default, the balance, dated today), with the invoice and
   means of payment.
6. **Cuenta** (account): a PDF with the contract's certificates, payments and balance.

## 8. Historial (history)

Every change, by whom, when, and how (a person, the AI with its model, or an import). Click one to
see its before and after.
- Deshacer (undo) takes back your last action. An AI answer or an import counts as one action.
- An undo that would erase someone else's later work is refused.

## 9. People and roles (La empresa)

People sign in with their Google account; each one has roles. The roles and what they may change:

| Role | May change |
|---|---|
| Administrador | everything; people and roles |
| Dirección de obra | project data, budget, Gantt, contracts, issue certificates, site book, service orders, AI |
| Jefe de obra | Gantt, contracts, site book, AI |
| Presupuestista | project data, prices, budget, standard library, AI |
| Planificación | Gantt, AI |
| Administración de contratos | contracts and measurements, contractors, AI |
| Tesorería | payments |
| Lector | nothing: only looks |

- Everyone can look at everything.
- A role given on "La empresa" counts in every project. A role in a project's **Equipo del
  proyecto** counts only there.
- People appear in the list the first time they sign in, with no roles. You can also add someone in
  advance by their Google address.
- The AI can do only what its person can.

## 10. Turning on Google sign-in (optional, for testing logins locally)

1. In Google Cloud Console: APIs & Services → Credentials → Create credentials → OAuth client ID →
   Web application.
   - Authorized redirect URI: `http://localhost:8064/auth/callback`.
   - Consent screen: Internal, if your company uses Workspace.
2. Download the JSON Google gives you and save it as `web/data/google-keys.json`.
3. Create `web/data/login.json`:
   ```json
   {"admins": ["you@gmail.com"], "domains": ["yourcompany.com"], "allowed": []}
   ```
   - `admins` are always administrators.
   - `domains` lets in every account of your Workspace.
   - `allowed` lists single addresses.
4. Run `npm start`. Now everyone has to sign in.

To go back to no logins, remove `google-keys.json`.

## 11. The AI assistant

1. Get an API key at console.anthropic.com. This is pay per use; the Claude Enterprise chat
   subscription doesn't include it.
2. Start the program with the key:
   ```
   ANTHROPIC_API_KEY=sk-ant-... npm start
   ```
   Or put it in `web/data/ai.json`:
   ```json
   {"apiKey": "sk-ant-...", "model": "claude-opus-5-5", "effort": "high", "webSearch": true}
   ```
3. Click **Asistente IA** and write what you want. Some examples:
   - "Buscá el precio actual del cemento portland en Córdoba y actualizalo"
   - "Agregá al presupuesto 120 m2 de mampostería de ladrillo hueco del 18"
   - "Hacé el certificado de este mes del contrato C-01 con el 40% de avance"
4. You see each step as it happens. Everything it changes is in the history with its model's name,
   and **Deshacer** takes back its whole answer.

The assistant has never been tried with a real key: please tell me how it does.

## 12. The site book (only through the AI for now)

The model and commands exist, but the screen doesn't yet. Meanwhile you can try it through the AI
assistant, for example:
- "Hacé el parte diario de hoy: llovió, día no apto, 4 personas de Juan Pérez"
- "Emití una orden de servicio al contrato C-01: rehacer el revoque del baño, plazo viernes"

## 13. Testing

In `web/`:
- `npm test` checks the model, the commands, the roles, the AI loop (with canned answers), the PDFs
  and the Spanish.
- `npm run build && npm run gui-test` drives every screen in a hidden Chromium.
  - `GUI_SHOTS=/some/folder` saves screenshots.
  - `GUI_LANG=en` runs it in English.
- When something fails on a screen, the browser's console (F12) and the terminal running `npm start`
  show why.

## 14. Changing the program (for you or the next Claude session)

- Read `CLAUDE.md` first: it explains the design and the pitfalls.
- Every change to the data is a command in `web/src/model/cmd.ts`. The screens and the AI use the
  same commands.
- When you add a command, also:
  - give it a line in `help()`;
  - give it its right in `web/src/model/roles.ts` (the test checks every command has one);
  - add a test.
- Texts are written `tr("...")`. Then:
  1. Run `npm run i18n`; it lists the texts with no Spanish.
  2. Add their Spanish to `web/scripts/fill-es.py`.
  3. Run `python3 -I scripts/fill-es.py`.
  4. Repeat until it says 0. `npm test` stops if a text has no Spanish.
- Open questions for you are in `questions-round3.txt` (not in git). Answer in `answers3.txt`.
