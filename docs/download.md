# Files to download by hand

## DOL -> data/raw/dol/
Page: https://www.dol.gov/agencies/eta/foreign-labor/performance

https://www.dol.gov//media/LCA_Disclosure_Data_FY2026_Q3.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/FY26Q3/LCA_Worksites_FY_2026_Q3.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/FY26Q3/LCA_Record_Layout_FY2026_Q3.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/FY26Q3/LCA_Worksites_Record_Layout_FY2026_Q3.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2025_Q4.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Worksites_FY2025_Q4.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Record_Layout_FY2025_Q4.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Worksites_Record_Layout_FY2025_Q4.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2024_Q4.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Worksites_FY2024_Q4.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Record_Layout_FY2024_Q4.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Worksites_Record_Layout_FY2024_Q4.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY2023_Q4.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Worksites_FY2023_Q4.xlsx
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Record_Layout_FY2023_Q4.pdf
https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Worksite_Record_Layout_FY2023_Q4.pdf

## USCIS -> data/raw/uscis/
Page: https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub

FY2024 and later are only in the hub's viewer. For each fiscal year:

1. Open the hub, choose the table (employer) view and filter Fiscal Year to one year.
2. Download > Crosstab > CSV (or Download > Data > full data, CSV). Either works:
   `etl/uscis_files.py` reads the six-category layout, the long `Measure Names` layout,
   UTF-16 or UTF-8, tabs or commas (docs/decisions.md D19).
3. Save it as `data/raw/uscis/uscis_hub_FY{year}.csv`, for example `uscis_hub_FY2024.csv`.
4. Run `uv run filed uscis && uv run filed aggregate` and check `eval/join.md`.

If the download holds several fiscal years, filter again: a file whose Fiscal Year column
disagrees with its name is refused.

## Also required: quarterly files FY2023 to FY2025

These releases are not cumulative (docs/decisions.md D1), so Q1 to Q3 are needed too:
`https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/LCA_Disclosure_Data_FY{2023,2024,2025}_Q{1,2,3}.xlsx`

## USCIS FY2023 (downloadable directly)

https://www.uscis.gov/sites/default/files/document/data/h1b_datahubexport-2023.csv

## IRS Exempt Organizations (optional) -> data/raw/irs/

Confirms 501(c)(3) status for the "likely cap-exempt" flag (docs/decisions.md D30).
Page: https://www.irs.gov/charities-non-profits/exempt-organizations-business-master-file-extract-eo-bmf

Download the regional CSV extracts (`eo1.csv` to `eo4.csv`) into `data/raw/irs/`. Any
`eo*.csv` there is read; without them the flag uses the NAICS and name rules only.
