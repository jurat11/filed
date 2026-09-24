# USCIS test fixtures (synthetic)

These files are **synthetic**: the counts are made up for tests and never reach the live
site. They copy the layouts of the USCIS H-1B Employer Data Hub so the parser and the
join can be tested without the real files:

- `h1b_datahubexport-2023.csv`: the legacy archive layout (Initial / Continuing columns).
- `uscis_hub_FY2024.csv`: the six-category layout, UTF-8, comma separated, with blank
  cells (missing, not zero).
- `uscis_hub_FY2025.csv`: a Tableau "Crosstab" download, UTF-16, tab separated, with
  thousands separators.

Employer names, states and tax ID last-4 digits are chosen to exercise the join against
the LCA fixtures in the parent folder: a name + state + tax-4 match (Google), a match that
needs "&" dropped (Ernst & Young), two USCIS rows for one employer (Apple), a single
candidate whose last 4 digits differ (Amazon.com Services, rejected), a USCIS-only
employer (Synthetic Test University) and a row with no employer name.
