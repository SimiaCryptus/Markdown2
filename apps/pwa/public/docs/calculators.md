---
title: Calculators
---
# Calculators

A **DataCalculator** workbook is a small, live calculator written as named values and formulas. You declare the inputs and how the results follow from them. The reader builds the form, and every result updates as you type.

| Form           | Fence name | Resource type                    |
| :------------- | :--------- | :------------------------------- |
| Text syntax    | `datacalc` | `text/vnd.datacalc`              |
| Canonical JSON |            | `application/vnd.datacalc+json`  |

Both names are provisional and not registered with IANA.

## A mortgage calculator

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

Change the rate or the term: the payment, the total and the interest follow at once. The source is ordinary text:

```text
<<<MORTGAGE type="text/vnd.datacalc" title="Mortgage"
input principal: money(USD) = 300000   { min: 0 }
input annualRate: percent   = 6.5%     { min: 0, max: 30% }
input years: integer        = 30       { min: 1, max: 50 }

payment: money(USD) = PMT(annualRate / 12, years * 12, -principal)

view form(principal, annualRate, years) -> payment
MORTGAGE
```

- `input` lines are values a reader can change. Each has a type and optional limits.
- Every other line is a formula. Formulas are pure: they can only compute.
- `view` lines say what to show: `form(...) -> ...`, `table(Sheet)` or `value(name)`. Without them, the reader builds a form from every input and result.

## Fenced calculators

A fenced block named `datacalc` works the same way. Ordinary Markdown previews show it as code:

```datacalc
input celsius: number = 21
fahrenheit = celsius * 9 / 5 + 32
kelvin     = celsius + 273.15
```

## Calculators with data

Sheets are typed lists of rows. Rows travel in the JSON form, which holds the formulas as text and the rows as data:

<<<SHOP type="application/vnd.datacalc+json" title="Shop margins"
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
        { "id": "p3", "name": "Gizmo", "cost": 4 }
      ]
    }
  }
}
SHOP

Change the markup factor, or a cost in the grid, and the prices, margins and average follow. You can add and remove rows too.

## Mistakes are shown, not hidden

A workbook with an error still renders. The problem is listed inside the calculator, and everything else keeps working:

```datacalc
input a: number = 4
ratio = a / 0
safe  = try(a / 0, 0)
typo  = aa * 2
```

`ratio` shows `#DivideByZero`, `safe` recovers, and `typo` reports the unknown name `aa`.

## What a calculator can and cannot do

- **Pure formulas.** No script, no network, no storage. A calculator from anyone is safe to open.
- **Sandboxed.** The live form runs in a frame with an opaque origin. It cannot reach this app, its storage, your keys or the toolbar.
- **Session state.** Values you type stay in this tab. Editing the document resets them to the defaults in the source.
- **Graceful.** Until the frame has loaded, and whenever it cannot, the calculator lists its named values as text.
- **Bundled.** DataCalculator is part of this reader; nothing is fetched to run it.

## Next

- [Music](music.md), Tartlet sketches you can play.
- [Back to the welcome page](index.md)