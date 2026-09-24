# Definitions

## LCA (Labor Condition Application)

An employer files an LCA (Form ETA-9035) with the Department of Labor before filing an H-1B, H-1B1 or E-3 petition with USCIS. DOL certifies it if it is complete and free of obvious errors. A certified LCA shows that an employer intended to hire into a role at a stated wage. It is not a petition and not a visa approval.

Source: DOL Office of Foreign Labor Certification, LCA disclosure data, https://www.dol.gov/agencies/eta/foreign-labor/performance

## Case status

The final status of an LCA in the disclosure file:

- **Certified**: DOL certified the LCA.
- **Certified - Withdrawn**: certified, then withdrawn by the employer. Counted as withdrawn on this site.
- **Withdrawn**: withdrawn by the employer before a decision.
- **Denied**: DOL denied the LCA.

"Filed" means all LCAs in the file, whatever the status.

## Wage level

The prevailing wage level (I, II, III or IV) that the employer selected on the LCA, from the OEWS wage survey. Level I is the entry level.

## USCIS H-1B Employer Data Hub

Counts of USCIS first decisions on Form I-129 H-1B petitions, by employer (tax ID last four digits, state, city, ZIP), completion fiscal year and two-digit NAICS code. Later decisions (appeals, revocations) and pending petitions are left out. Counts are of workers, not petitions. State and city are the employer's mailing address, not the worksite.

Source: https://www.uscis.gov/tools/reports-and-studies/h-1b-employer-data-hub/understanding-our-h-1b-employer-data-hub (last reviewed by USCIS 07/07/2025)

The hub reports six categories of approvals and denials. USCIS's definitions, summarized:

| Category | Form I-129 Part 2, Question 2 selection |
| --- | --- |
| New Employment | "New employment": the worker is outside the US with no status, is starting with a new employer in a different nonimmigrant classification (for example a change of status from F-1), or is staying with the same employer in a different classification |
| New Concurrent | "New concurrent employment": an additional employer, same classification, while keeping the current job |
| Continuation | "Continuation of previously approved employment without change with the same employer" |
| Change with Same Employer | "Change in previously approved employment": a non-material change, such as a new job title |
| Change of Employer | "Change of employer": a new employer, same classification |
| Amended | "Amended petition": a material change in the terms of employment |

### Initial and continuing on this site

- **Initial** = New Employment + New Concurrent. These are workers new to H-1B employment with that employer in that classification. A student moving from F-1 (OPT) to H-1B is counted under New Employment.
- **Continuing** = Continuation + Change with Same Employer + Change of Employer + Amended.

This grouping follows the "initial" and "continuing" wording USCIS still uses on the Understanding page. The reason is written in `docs/decisions.md`. The raw six columns are also kept, and the employer page shows New Employment on its own.

## Weighted H-1B cap selection

For the FY2027 cap season and later, when USCIS receives more registrations than it needs, it runs a weighted selection. Each unique beneficiary is entered once for wage level I, twice for level II, three times for level III and four times for level IV. The level is generally the highest OEWS wage level that the offered wage equals or exceeds for the occupation and area.

- Final rule: "Weighted Selection Process for Registrants and Petitioners Seeking To File Cap-Subject H-1B Petitions", 90 FR, December 29, 2025, https://www.federalregister.gov/documents/2025/12/29/2025-23853/weighted-selection-process-for-registrants-and-petitioners-seeking-to-file-cap-subject-h-1b
- **Effective date: February 27, 2026.**
- USCIS announcement: https://www.uscis.gov/newsroom/news-releases/dhs-changes-process-for-awarding-h-1b-work-visas-to-better-protect-american-workers

The LCA wage level shown on this site is the prevailing wage level on past LCAs. It is a guide to where an employer usually files, not the level USCIS will assign to a future registration.

## Entry-level signal

For the last two loaded fiscal years, per employer:

- **Entry-level LCAs** = certified LCAs whose SOC code is in the selected role groups and whose wage level is I or II.
- **Entry-level share** = entry-level LCAs / all certified LCAs of that employer, same years.
- **USCIS initial approvals** = sum of initial approvals (as defined above), same fiscal years.

This is a count and a share, not a score and not a probability of sponsorship.

## Wages

Offered wages (the lower bound, `WAGE_RATE_OF_PAY_FROM`) are annualized: Year x1, Month x12, Bi-Weekly x26, Week x52, Hour x2080. Annualized values under $15,000 or over $1,000,000 are treated as unit errors: the row is kept and counted, but left out of wage statistics. Wage percentiles use certified, full-time LCAs with a valid wage only.
