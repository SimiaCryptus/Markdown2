---
title: Data tables
---
# Data tables

Markdown tables are fine for a handful of rows. For real data, embed it as **CSV** or **TSV**, or link to a separate file. Either way, the reader shows it as a live grid.

Every table on this page, the Markdown one included, works the same way:

- **Sort.** Click a column heading. Click again to reverse, a third time to restore the original order. Numbers sort as numbers, and empty cells always go last.
- **Filter.** Type in the box above a table. Choose a column to search only that one.
- **Hide columns.** Open *Columns* and untick the ones you do not need.
- **Resize columns.** Drag the right edge of a heading. Double-click an edge to reset every width. From the keyboard, focus a heading and press Alt+← or Alt+→.
- **Resize rows.** Drag the bottom edge of a row. Taller rows wrap their text. Double-click the edge to reset.
- **Reset** puts everything back.

Your choices survive as you edit the source, and are cleared when another document opens. The data itself never changes.

## Embedded CSV

`text/csv` follows RFC 4180. Commas separate fields, and a field in double quotes may hold commas, line breaks and doubled `""` quotes:

<<<ELEMENTS type="text/csv" title="The first twenty elements" filename="elements.csv"
Number,Symbol,Name,Atomic mass,Category,Discovered
1,H,Hydrogen,1.008,Nonmetal,1766
2,He,Helium,4.0026,Noble gas,1868
3,Li,Lithium,6.94,Alkali metal,1817
4,Be,Beryllium,9.0122,Alkaline earth metal,1798
5,B,Boron,10.81,Metalloid,1808
6,C,Carbon,12.011,Nonmetal,Ancient
7,N,Nitrogen,14.007,Nonmetal,1772
8,O,Oxygen,15.999,Nonmetal,1774
9,F,Fluorine,18.998,Halogen,1886
10,Ne,Neon,20.180,Noble gas,1898
11,Na,Sodium,22.990,Alkali metal,1807
12,Mg,Magnesium,24.305,Alkaline earth metal,1755
13,Al,Aluminium,26.982,Post-transition metal,1825
14,Si,Silicon,28.085,Metalloid,1824
15,P,Phosphorus,30.974,Nonmetal,1669
16,S,Sulfur,32.06,Nonmetal,Ancient
17,Cl,Chlorine,35.45,Halogen,1774
18,Ar,Argon,39.948,Noble gas,1894
19,K,Potassium,39.098,Alkali metal,1807
20,Ca,Calcium,40.078,Alkaline earth metal,1808
ELEMENTS

Try it: sort by *Atomic mass*, filter for `noble`, or hide *Symbol*. Columns that hold only numbers are right-aligned and sort numerically. *Discovered* mixes years with `Ancient`, so it sorts naturally instead.

Quoting keeps awkward values intact:

<<<BOOKS type="text/csv" title="Quoted fields"
Title,Author,Note
"Gödel, Escher, Bach",Douglas Hofstadter,"A field with commas"
"The ""Mythical"" Man-Month",Fred Brooks,Doubled quotes become one
"Structure and Interpretation
of Computer Programs","Abelson, Sussman","A line break, inside quotes"
BOOKS

## Embedded TSV

`text/tab-separated-values` separates fields with tab characters and has no quoting, which makes it the natural format for data pasted from a spreadsheet:

<<<TIMES type="text/tab-separated-values" title="A timetable"
Departs	Arrives	Train	Platform	Notes
06:42	07:31	IC 201	4	
07:15	08:02	RE 17	2	Bicycles allowed
07:48	08:29	IC 203	4	Quiet coach
08:20	09:14	RB 42	1	Stops everywhere
09:05	09:51	IC 205	3	
TIMES

## Without a header row

The first line is taken as the headings. Say `header=absent`, a parameter RFC 4180 defines for `text/csv`, when the data has none:

<<<RAW type='text/csv; header=absent' title="No header row"
north,42,up
south,31,down
east,18,steady
RAW

## Linked to a separate file

Large data belongs in its own file. `encoding="uri"` points at it:

```text
<<<PLANETS type="text/csv" encoding="uri" title="The planets" filename="planets.csv"
data/planets.csv
PLANETS
```

<<<PLANETS type="text/csv" encoding="uri" title="The planets, from a separate file" filename="planets.csv"
data/planets.csv
PLANETS

Like every remote resource, it stays locked until you choose *Load…*. Then the file is fetched without cookies, and the declared type, `text/csv`, decides how it is shown.

- A relative address such as `data/planets.csv` resolves against the address of a document opened by URL, like this page, and must stay on that site.
- In a local draft there is no address to resolve against, so use an absolute `https:` address instead.
- In a repository, linked files keep large data out of the prose, so diffs stay readable.

## Fences and Markdown tables

A fenced block named `csv` or `tsv` becomes a grid too. Ordinary Markdown previews show it as code:

```csv
Language,First appeared,Typing
Lisp,1958,Dynamic
C,1972,Static
Python,1991,Dynamic
Rust,2015,Static
```

And a plain Markdown table gets the same controls:

| Format | Separator | Quoting      | Media type                  |
| :----- | :-------: | :----------- | :-------------------------- |
| CSV    | `,`       | `"…"`        | `text/csv`                  |
| TSV    | tab       | none         | `text/tab-separated-values` |
| GFM    | `\|`      | backslash    | prose, no type              |

## Limits and fallbacks

- A table shows up to 10,000 rows and 256 columns. Larger data says how many rows were left out.
- Invalid UTF-8 shows the resource's fallback with `handler-error`.
- Every cell is text. Nothing in a table can run or fetch anything.
- *Save* in the Resources tab downloads the data as `.csv` or `.tsv`.

## Next

That is the end of the tour.

- [Join the community](community.md): Markdown2 is open source, and ideas are welcome.
- [Back to the welcome page](index.md), the showcase where it all started.