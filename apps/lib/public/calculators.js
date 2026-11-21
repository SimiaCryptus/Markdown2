import { initChrome, mountEditableDemo, run } from './shared.js';

initChrome();

const CALC_SRC = `### Mortgage calculator (\`text/vnd.datacalc\`)

<<<MORTGAGE type="text/vnd.datacalc" title="Mortgage"
input principal: money(USD) = 300000   { min: 0 }
input annualRate: percent   = 6.5%     { min: 0, max: 30% }
input years: integer        = 30       { min: 1, max: 50 }

monthlyRate = annualRate / 12
n           = years * 12
payment: money(USD)   = PMT(monthlyRate, n, -principal)
totalPaid: money(USD) = payment * n
interest: money(USD)  = totalPaid - principal

view form(principal, annualRate, years) -> payment, totalPaid, interest
MORTGAGE

### Temperature converter (fenced \`\`\`datacalc)

\`\`\`datacalc
input celsius: number = 21
fahrenheit = celsius * 9 / 5 + 32
kelvin     = celsius + 273.15
\`\`\`
`;

const SHEET_SRC = `<<<SHOP type="application/vnd.datacalc+json" title="Shop margins"
{
  "datacalc": "1.0",
  "params": {
    "factor": { "input": true, "type": "number", "formula": "1.2", "opts": { "min": "1" } },
    "avgMargin": { "formula": "AVG(Products.margin)" }
  },
  "sheets": {
    "Products": {
      "columns": {
        "id": { "type": "string", "key": true },
        "name": { "type": "string" },
        "cost": { "type": "number", "opts": { "min": "0" } },
        "price": { "formula": "cost * factor" },
        "margin": { "formula": "price - cost" }
      },
      "rows": [
        { "id": "p1", "name": "Widget", "cost": 10 },
        { "id": "p2", "name": "Gadget", "cost": 25 },
        { "id": "p3", "name": "Gizmo",  "cost": 4 }
      ]
    }
  }
}
SHOP
`;

run(async () => {
  await mountEditableDemo({
    editorId: 'calc-src',
    viewId: 'calc-view',
    resetId: 'calc-reset',
    timeId: 'calc-time',
    source: CALC_SRC,
  });

  await mountEditableDemo({
    editorId: 'sheet-src',
    viewId: 'sheet-view',
    resetId: 'sheet-reset',
    timeId: 'sheet-time',
    source: SHEET_SRC,
  });
});
