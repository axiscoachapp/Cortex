# PersonalMed 2005 → Cortex: structural analysis, mapping and migration plan

Status: analysis only. Nothing has been loaded into any database, local or remote. As the README says, the migration is a later task and needs explicit owner approval at each step below.

Update 2026-11-03: the implementation spec in [CODEX_IMPLEMENTATION.md](CODEX_IMPLEMENTATION.md) supersedes §4 where they differ. For example, `patients` now has CPF, sex and health-plan columns, and the running history can be split by its typed dates. Registration quality and the legal requirements for prescriptions are in [CADASTRO_E_RECEITAS.md](CADASTRO_E_RECEITAS.md).

Source: the Haddad Nicola clinic export dated 24/08/2026: 1,758 files, 745 MB, received as a `.rar`.

Privacy: this document holds **no patient data**. It contains only schema, counts, rates, date ranges at month or year precision, and masked value shapes (`9` = digit, `a` = a run of letters). Doctors are referred to by their PersonalMed account code (`UserNumber`), never by name.

All numbers below were measured with the scripts in `scripts/personalmed/`, described in §8. Statements marked **(inferred)** come from field names, value shapes or cross-tabs. They are not documented vendor semantics and need confirming with the clinic.

---

## 0. Key findings

1. **The patient master is not in the Paradox tables.** The export also contains a **SQL Server 2000 (MSDE) database**: `PersonalMed2005_Data.mdf`, plus a `.LDF` log and a `.bkp` backup of about 185 MB. That database holds:
   - `Clini_01`: patient registration, 32,882 patients.
   - `Clini_02`: per-doctor chart headers, 34,796 rows.
   - `Me`: free-text chart pages, 17,581 rows.

   Every Paradox clinical table refers to patients only through `PCod`. Any migration has to read both stores.
2. **No table is encrypted.** All 406 Paradox tables are format v7. Every header's record count matches its block chain.
3. **Code page.**
   - 401 Paradox tables use **cp1252**. This is verified: 99.6% of the bytes above 0x7F decode to Portuguese letters, against 14% if read as cp850.
   - Five reference tables use cp437.
   - SQL Server `varchar` data is cp1252 and `ntext` is UTF-16.
4. **Charts are per doctor in PersonalMed.**
   - A patient's registration is shared clinic-wide.
   - Each doctor keeps a separate chart for that patient: one `Clini_02` row per patient × doctor, plus per-doctor clinical tables.
   - This maps naturally onto Cortex's per-doctor patient lists (§4.1).
5. **There are six doctor accounts with data**: codes 2, 3, 4, 5 and 11 (specialty code `GI2`, gynecology/obstetrics) and code 9 (`URO`). There are also five secretary accounts and one admin account.
6. **The clinical core is mostly RTF free text.** It has:
   - a running per-patient × doctor history (`Co12_1`),
   - dated evolution notes with vital signs (`Co28`),
   - 72,565 issued documents (prescriptions, letters, exam requests) in `Clini_06`,
   - CID-10 codes (`Co12_2`),
   - prenatal records (`Co49_1/2`),
   - chart pages (`Me`).
7. **Data range.**
   - Activity runs from 2007-01 to 2026-08, with 1,024 future appointments up to 2027-05.
   - First-visit dates carried over from an older system go back to 1990.
   - The clinic is live: 9,178 patients had activity in 2025–2026.

---

## 1. Inventory

### 1.1 What the export contains

| Item | Count / size | Notes |
|---|---|---|
| Paradox tables (`.DB`) | 406 | All Paradox 7. 395 were modified in 2026, most of them on the export day; 11 legacy reference tables date from 2002–2022. |
| Primary indexes `.PX` | 402 | Not needed for reading. |
| Memo/BLOB files `.MB` | 140 | Needed for memo and image fields. |
| Validity checks `.VAL` | 267 | Not parsed: they hold referential and lookup rules, not data. |
| Secondary indexes `.XG*/.YG*/.X0*/.Y0*` | 530 | Not needed. |
| `.TV` (4), `.FAM` (3), `PARADOX.LC-` | — | Table views, families, and the BDE lock file. |
| **`PersonalMed2005_Data.mdf`** | 185.3 MB (22,624 pages of 8 KB) | SQL Server 2000 on-disk format. Torn-page detection is on: the reader restored the torn bits on 12,634 pages. |
| `PersonalMed2005_log.LDF` | 0.8 MB | Transaction log. |
| `PersonalMed2005.bkp` | 185.0 MB | SQL Server backup, a transactionally consistent alternative to the `.mdf`. |
| `Problems.txt` | 166 B | Written by a repair utility at export time. It reports one block/record-number error in `age04.db` (see §5). |
| `LG200308.txt` | 167 KB, 3,256 lines | A 2008 BDE repair log, about 190 "Tabela … Registro" entries. Historical only. |

**Paradox totals.** 145 tables hold data and 261 are empty, with 926,930 records in all. All tables are v7 (`fileVersionId` 12). `encryption2` is 0 on every table, so **none is password-protected**. Header record counts match the block chains on all 406 tables.

**Code pages (Paradox header `dosCodePage` and sort order).**
- 401 tables are cp1252. Their sort orders are `ANSIINTL` (396), `ANSII850` (4) and `DBWINWE0` (1).
- 5 tables are cp437 with sort order `intl`: `TOcup`, `TFamilia`, `TSubgp`, `TSubgpPr` and `TGd_Grup`, the CBO occupation reference tables.

The decoding was checked over all alpha fields:

| Tables | Bytes ≥ 0x80 | Portuguese letters as cp1252 | as cp850 | as cp437 |
|---|---|---|---|---|
| cp1252 tables | 53,049 | **52,850** (52 odd characters) | 7,354 | 36 |
| cp437 tables | 3,310 | 0 (2,107 odd characters) | 3,309 | **3,309** |

On the SQL Server side, `varchar` decoded as cp1252 gives 0 odd characters across the `Clini_01` text fields. All `ntext` data is UTF-16 with zero high bytes.

### 1.2 SQL Server database (`PersonalMed2005_Data.mdf`)

| Table | Rows (counted) | `sysindexes.rowcnt` | Data pages | LOB pages | Purpose |
|---|---|---|---|---|---|
| `Clini_01` | 32,882 | 32,882 | 2,252 | 814 | **Patient registration (cadastro)** |
| `Clini_02` | 34,796 | 34,794 | 817 | 0 | **Chart header per patient × doctor**: first and last visit |
| `Me` | 17,581 | 17,522 | 169 | 8,221 | **Free-text chart pages per patient × doctor** (RTF in `ntext`, 53 MB) |
| `Clini_01_Lock` | 5 | 5 | 1 | 0 | Record locks (ignore) |
| `dtproperties` | — | — | — | — | SQL Server diagram metadata (ignore) |

The database also has 30 stored procedures and 2 views. Where row counts differ, the stored `rowcnt` is stale; SQL Server 2000 updates it lazily. The tables have no duplicate keys.

### 1.3 Paradox tables by purpose

Record counts are in parentheses. Empty tables are listed by name only.

**Patients / registration (cadastro)**
- `Clini_01` lives in SQL Server (above).
- `Clini_05`: health-plan cards per patient (62,204).
- Empty: `Clini_03`, `Clini_07` (occupational-health employee data), `Clini_10` (problem list), `Clini_12`–`17`.

**Agenda**

| Table | Rows | Purpose |
|---|---|---|
| `age03` | 292,537 | Schedule slots: doctor, date, start time, duration, type, short note |
| `Age04` | 273,794 | Appointment data for a slot: patient, status, arrival time, start of care, appointment type, health plan, pre-registration blob |
| `age01` | 12,158 | Doctor day notes |
| `age05` | 8,312 | Timed notes and reminders |
| `Age09` | 3,853 | Walk-in ("pronto atendimento") queue, 2006-12 to 2011-05 (obsolete) |
| `age02` | 54 | Appointment types |
| `age06` | 51 | Weekly working hours |
| `age08` | 650 | Per-weekday limits by health plan |
| `age07` | 8 | |
| `AgFone` | 924 | Phone book of third-party contacts. These are not patients. |
| `age10` | — | Empty |

**Chart: evolution and clinical text**

| Table | Rows | Content |
|---|---|---|
| `Co12_1` | 26,864 | Running clinical text per patient × doctor. Chart component 12, "Diagnóstico", is used as a running log (66 MB). |
| `Co28` | 28,598 | Dated evolution notes with vital signs ("Evolução") |
| `Co12_2` | 63,062 | Dated CID-10 codes |
| `Me` (SQL) | 17,581 | Chart pages: QP/HDA, history ("Antecedentes") and others |

**Issued documents: prescriptions, letters, exam requests**
- `Clini_06` (72,565): type 1 "Receita" 51,195; type 2 "Textos" 18,286; type 3 "Sol. exames" 3,084.
- Templates: `Us05` (1,091), `Gintxt` (18), `Pedtxt` (14).

**Obstetrics and gynecology specialty tables**

| Table | Rows | Content |
|---|---|---|
| `Co49_1` | 4,502 | Pregnancies |
| `Co49_2` | 16,316 | Prenatal visits |
| `Co50` | 376 | Contraception |
| `Co51` | 292 | Climacteric |
| `Co51_1` | 1 | |
| `Co53` / `Co53_1–3` | 3 / 1 each | Breast |
| `CO54` / `CO54_1` / `CO54_3` | 2 / 1 / 1 | Delivery and puerperium |
| `CO55` / `CO55_1` / `CO55_2` | 5 / 3 / 2 | Urogynecology |
| `CO43` | 3 | Surgeries |

**Exams, results and images**

| Table | Rows | Content |
|---|---|---|
| `Co31` | 79 | Gynecology exam reports, 2007–2008 |
| `Co31_1/3/4/5/6/7` | 9 / 2 / 21 / 10 / 21 / 16 | Detail tables. They include 27 embedded BMP images. |
| `Co31_P` | 8 | Templates |
| `CO52` | 19 | Exam images: 19 embedded BMP |
| `Clini_04` | 174 | Patient images: 20 embedded JPEG and **152 references to external files that are not in the export** |
| `Clini_08` | 53 | Lab results, 2005–2007 |
| `LabExam` | 155 | Lab exam catalogue |
| `Labs` | 1 | |
| `CO54` / `CO55` | — | Partly exams |
| Empty | — | `Co17*` (ENT), `Co20*` (ophthalmology), `Co22*` (cardiology), `Co18`, `Co19`, `Co21*`, `Co25*`, `Co33*`, `Co34`, `CO44`–`48`, `Aud_*` |

**Financial, health plans and TISS**
- With data: `Financas` (1,652; 2007-10 to 2023-04), `Carrier` (25 health plans), `fin_51` (25), `Fin_58` (25), `Fin_60` (24), `FIN_61` (24), `Fin_62` (21), `Fin_02/04/17/33/50/59`, `Acomod`, `Atendim`, `CarrMA` (2002).
- Health-plan references held in other tables: `Clini_05`, `Age04.CarrierCod`, `age08`.
- Empty: `Unimed`, `UnimedLT`, `UMPROC*`, `Sys050` (2 rows), `Con_*`, `Fin_01/03/20/31/32/36/63/64`.

**Configuration and lookup** (reference data, not clinic data)
- Coding tables: `Cid10` (14,714), `Cid10cap` (277), `Cid9` (6,135), `Amb90/92/96` (3,616 / 4,025 / 4,189), `Ciefas` (4,038), `Sys073`, `Sys072`.
- Drug database: `Def` (6,626, 19.6 MB) and the older `DefMA` (4,501).
- Occupations (CBO): `TOcup` (2,422), `TFamilia`, `TSubgp`, `TSubgpPr`, `TGd_Grup`.
- Chart layout and models: `Ms00`–`Ms03`, `Us03`, `Us04`.
- Settings: `Cfg01` (letterhead images), `Cfg03`, `cfg05`, `Cfg08`, `CfgEtq`.
- Other `Sys*`, `SYS05x`/`06x` and `Dat00x`/`PCMSO*` (occupational health) tables, `Val_norm`, `VaccfgMA`, `Vac_cfg`, `SYS062`, `ld01`.

**Users and professionals**
- `Us01`: 12 accounts.
- `Sys011`: 13 professionals.
- `Us02`: 6 per-doctor print headers, CRM and signature.
- `US12`, `Us08`, `Us09`, `Us10`.

**Logs and messaging**
- `Messages`: 77 internal messages (RTF).
- `news`, `NewsVer`, `newsimgs`, `lotes`, `Sys063` (sync).
- `LG200308.txt`, `Problems.txt`.

**Empty or obsolete modules**
- `PPP*`, `Perfil_*`, `Tra_*`, `Sto_*`, `Sis_*`, `PROPTB*`, `MEDAL*`, `CBHPM*`, `LPM99`, `ArquiCri`, `ArquiLT`, `UserCri`, `UserLT`, `bibliogr`, `DiagPess`, `Formulas`, `resttem*`.
- Most `Co0xxxxx` occupational-health forms.

**Credentials in the export.** `Us01.Pass`, `Cfg08.SPassword` and the web login/password fields in `US12` hold staff login data. They were not inspected and **must never be migrated**. See §6.

### 1.4 Users

These are taken from `Us01` as codes only:

| UserNumber | Type | Specialty code | Has clinical data |
|---|---|---|---|
| 1 | A (admin) | — | no |
| 2, 3, 4, 5, 11 | M (doctor) | GI2 (gynecology/obstetrics profile) | yes |
| 9 | M (doctor) | URO | yes |
| 6, 7, 10, 12, 13 | S (secretary) | — | only agenda notes (`age01`, `age05`, `age06`) |

### 1.5 Date range

| Source | Range (month) |
|---|---|
| Appointments `Age04.Data` | 2007-01 – 2027-05; 1,024 rows in the future |
| Evolution notes `Co28`, CID `Co12_2` | 2007-03 – 2026-08 |
| Documents `Clini_06` | 2011-02 – 2026-08 |
| Prenatal visits `Co49_2` | 2007-03 – 2026-08 |
| `Clini_01.LastModified` | 2007-01 – 2026-08 |
| `Clini_02.FirstMedAdvice` (first visit) | 1990 – 2026. 72 rows hold the Delphi "zero date" 1899-12-30 and 1 row holds 2088. |
| Birth dates | 1914-04 – 2024-03 |

Appointments per year rise from 6,866 in 2007 to about 14,000–17,500 a year from 2011 to 2025. 2026 has 11,893 up to August.

---

## 2. Core table schemas

Coverage below is the share of rows with the field filled.

### 2.1 `Clini_01` (SQL Server): patient registration, 32,882 rows

| Field | Type | Coverage / shape | Meaning |
|---|---|---|---|
| `Unit` | int | always 0 | Clinic unit; there is only one |
| `PCod` | int | 1..33,738, unique | **Patient key** |
| `Name` | varchar(40) | 100% | Full name. 95% are all upper case. 1,038 names contain digits, for example the shapes `a a 99:99` and `a 9 a`, i.e. annotations inside the name (inferred). |
| `Address`, `District`, `City`, `Zip`, `State` | varchar | 86% / 84% / 83% / 55% / 66% | Address. Zip shapes are `99999999` and `99.999-999`. |
| `Phone` | varchar(40) | 91.5% | Main phone: `99999999`, `9 9999 9999`, `9999-9999` |
| `Cellular` / `DDDCellular` | varchar(9) / (2) | 37% / 4% | Mobile number and area code |
| `PhoneCountryCode`, `FAXCountryCode`, `CellularCountryCode`, `NC`, `PatientWebID` | — | 0% | Unused |
| `FAX` | varchar(20) | 36% | **Reused for the CPF** (inferred). 8,450 values have 11 digits and 8,199 of them pass the CPF checksum. Shapes are `999 999 999 99` and `999.999.999-99`. |
| `EMail` | varchar(40) | 26% | Only 900 of 8,592 values contain `@` (879 look valid). The column is mostly reused for something else (inferred). |
| `BirthDate` | datetime | 88.8% | Date of birth |
| `ID`, `IDUF`, `IDDispatcherOrgan`, `IDEmission` | | 81.5% / 26.5% / 16.6% / 0.3% | RG (identity card) number, state, issuing body and issue date (inferred) |
| `Sex` | varchar(1) | 75% | F 23,240; M 1,545 |
| `CivilStatus` | varchar(1) | 84% | C 15,439, S 9,375, D 1,515, V 851, O 233, P 178. Inferred: married, single, divorced, widowed, other, ? |
| `Occupation` | varchar(30) | 79% | Profession |
| `IndicatedBy` | varchar(40) | 78% | Referral source, often a person's name, so third-party data (inferred) |
| `HomeBorn` | varchar(30) | 66% | Place of birth (naturalidade) |
| `Race` | varchar(10) | 0.2% | |
| `BloodType` | varchar(3) | 9.5% | 8 ABO/Rh values |
| `Mother` / `Father` | varchar(40) | 48% / 43% | Parents' names |
| `Attention` | ntext (RTF) | 5,442 non-empty | **"Atenção" alert text**: may contain allergies or warnings (inferred). Plain text is about 38 characters at the median and 764 at most. |
| `Observation` | ntext (RTF) | 98 non-empty | Notes |
| `LastModified` | datetime | 96% | Registration last modified |
| `MailKind`, `Options`, `Off_Line` | | constant | Ignore |

### 2.2 `Clini_02` (SQL Server): chart header per patient × doctor, 34,796 rows

The key `(PCod, UserNumber)` is unique. 32,853 distinct patients and 6 doctors.

| Doctor | 2 | 3 | 4 | 5 | 9 | 11 |
|---|---|---|---|---|---|---|
| Charts | 6,406 | 8,882 | 10,170 | 5,341 | 3,266 | 731 |

- `FirstMedAdvice` is the first visit (inferred).
- `LastMedAdvice` is the last visit: 84% filled, 2007-01 to 2026-08.
- `ReturnMedAdvice` is unused: 33,037 rows hold 1899-12-30 and the rest are null.
- `Model` is a binary(60) value with 6 distinct values, probably each doctor's chart layout (inferred).

### 2.3 `Me` (SQL Server): chart pages, 17,581 rows

- **Key**: `(PCod, UserNumber, CompNumber)`, unique. Covers 12,952 patients.
- **`CompNumber` 201–209** are user-defined chart pages. Each doctor's page titles are in `Us04`:
  - 201 is "QP/HDA" for every doctor: 13,010 rows.
  - 202 is "Antecedentes": 1,130 rows.
  - 203–209 differ by doctor: for example "Hábitos" for the urologist, and "Pré-Natal", "Aborto Habitual", "Exam Infertilidade", "Exam Menopausa", "Histórico Pessoal", "Estética" and "Preventivos" for others.
- **`Contents1`** is RTF stored as `ntext` in 17,531 rows.
  - Plain text after conversion: 438 characters at the median, 2,269 at the 90th percentile, 13,088 at most.
  - 752 rows are empty once the RTF is stripped.
  - 5,086 rows contain at least 2 dd/mm/yyyy date stamps.
- **`Contents2`** has 4 rows. `Contents3` and `Contents4` are empty.

### 2.4 Paradox clinical core

**`Co12_1`: running clinical text per patient × doctor** (26,864 rows)
- Key: `(Unit, PCod, UserNumber)`. Covers 26,089 patients.
- `Contents` is an RTF memo in 26,407 rows. Plain text is 563 characters at the median, 4,053 at the 90th percentile and 19,072 at most.
- **10,458 documents contain at least 2 date stamps** (90th percentile 16, maximum 162). It is a chronological log with no per-entry structure (inferred).
- By doctor: 2 → 5,340; 3 → 8,511; 4 → 7,878; 5 → 4,576; 11 → 477; 9 → 82.

**`Co28`: "Evolução"** (28,598 rows, 4,980 patients)
- Doctor 2 wrote 27,301 of them.
- Fields:
  - `DataInsert` (timestamp, 2007-03 to 2026-08)
  - `Observation` (RTF, 91%; median plain text 59 characters)
  - `Weigth` (sic)
  - `Height`: integer, with outliers up to 10,060
  - `FC` (heart rate)
  - `Pressure`: 49%, shape `999/99`
  - `Temperature`: almost always 0
- Twelve or so TISS/XML-era fields are empty.

**`Co12_2`: CID-10 codes** (63,062 rows, 8,213 patients)
- `DateInsert`, plus `CidCod` with shape `a99.9` (273 distinct codes) and its `Description`.
- Doctor 2 entered 53,611 rows.
- The flags for principal and suspected diagnosis are empty.

**`Clini_06`: issued documents** (72,565 rows, 12,382 patients)
- `ImpNumber` is a per-patient sequence.
- `DateInsert` runs from 2011-02 to 2026-08.
- `ModelType` and `Description`: 1 = "Receita", 2 = "Textos", 3 = "Sol. exames".
- `Contents` is RTF: plain text 292 characters at the median and 3,192 at most. No embedded pictures.
- By doctor: 5 → 30,600; 3 → 23,576; 2 → 15,207; 4 → 2,885; 9 → 195; 11 → 102.

**`Co49_1`: pregnancies** (4,502 rows, 3,466 patients)
- Fields: `NumberGestation` (1–5), `DUM`, `DPP` (66 dates in the future), `IG`, ultrasound dating (`DataEco`, `IGECO*`, `DppEcos`), about 40 logical risk flags (`RA*`, `RB*`, `RC*`), `NameSon` (26%) and `ResGin` (38 memos).
- `Parturition` and `PDPECO` mostly hold the 1899 sentinel.

**`Co49_2`: prenatal visits** (16,316 rows, 2,326 patients)
- `Date`, plus:
  - `Ig` (gestational age in weeks)
  - `Weight`
  - `Pressure`
  - `Edema` (0–3)
  - `Au` (fundal height)
  - `BCF` (fetal heart rate): 80%, shape `999`
  - `MF` (fetal movements)
  - `Touch`: 3%

### 2.5 Agenda

**`age03`: schedule slot** (292,537 rows)
- Key: `(UserNumber, Data, Inicio)`.
- `Duracao` is in minutes: mostly 15 or 20.
- `Tipo` values:
  - C (273,735): appointment slot (inferred).
  - B (10,503): block, with long durations (inferred).
  - P (8,291): unknown.
- `Obs` is a short text in 159,274 rows, with a median of 6 characters. It is probably a label typed into the slot.

**`Age04`: appointment** (273,794 rows)
- 1:1 with `age03` on `(UserNumber, Data, Inicio)`: 273,742 rows match and 52 are orphans.
- `PCod` is filled in 208,328 rows (76%). Every one resolves to `Clini_01`.
- The remaining 65,466 rows have **`PreCadastro`**, a 1,029-byte Delphi record for patients who were scheduled before being registered. Its byte layout:
  - offset 0: name (shortstring)
  - offset 256: phone
  - offset 512: mobile
  - offset 1024: health-plan code (255 = none)
- `Chegada` is the arrival time and `InicioAtendimento` the start of care.
- `IDTipo` links to `age02.ID`: CONS 265,159, "cons + c.o" 4,291, RET 4,141, and others.
- `CarrierCod` is the health plan.

`Estado`, cross-tabbed against arrival and start times (meanings inferred):

| Code | Rows | Arrival / start present | Meaning (inferred) |
|---|---|---|---|
| T | 190,320 | yes / yes | attended |
| C | 52,250 | no / no; 42,314 have no patient code | cancelled |
| F | 11,420 | no / no | no-show ("falta") |
| A | 1,635 | yes / no | arrived but never started |
| E | 266 | yes / yes | in progress, never closed |
| `-` | 17,903 | no / no | no status: 1,022 future, 16,881 past |

---

## 3. Relationships and match rates

Join key: `PCod` for patients, and `UserNumber` (`Us01`) for doctors. `Unit` is always 0.

| Join | Child rows matched | Parent keys referenced |
|---|---|---|
| `Clini_02.PCod → Clini_01` | 100% (34,796) | 99.9% of patients have a chart |
| `Age04.PCod → Clini_01` (non-null) | 100% (208,326); 2 attended orphans | 94.5% |
| `Me.PCod → Clini_01` | 100% | 39.4% |
| `Co12_1.PCod → Clini_01` | 99.996%; 1 orphan | 79.3% |
| `Co12_2` / `Co28` / `Clini_06` / `Co49_1` / `Co49_2` / `Clini_04` / `Age09` `→ Clini_01` | 100% each | 25% / 15% / 38% / 10.5% / 7.1% / 0.5% / 5.2% |
| `Clini_05.PCod → Clini_01` | 99.998% | 99.7% |
| `(PCod, UserNumber)` of `Me`, `Co12_1`, `Co28`, `Clini_06` → `Clini_02` | 100% each (1 row short for `Co12_1`) | Every clinical row belongs to an existing chart |
| `(PCod, UserNumber)` of `Age04` → `Clini_02` | 95.2% of rows (198,428) | Some appointments are with a doctor who has no chart for that patient |
| `Age04 ↔ age03` on `(UserNumber, Data, Inicio)` | 100% of `Age04` | 93.6% of slots have an appointment |
| `Age04.UserNumber → Us01`; `CarrierCod → Carrier`; `Clini_05.CarrierCod → Carrier` | 100% | — |

**Doctors per patient**, counting every chart, clinical row and attended appointment:

| Doctors | 1 | 2 | 3 | 4+ | none |
|---|---|---|---|---|---|
| Patients | 28,701 | 3,445 | 595 | 112 | 29 |

That makes **4,152 patients with more than one doctor**.

**Patient × doctor pairs** (37,840 in total):
- 27,541 have clinical content.
- 7,255 have a chart header only.
- 3,044 have attended appointments but no chart.

**Patient coverage.**

| Coverage | Patients |
|---|---|
| Clinical content | 26,631 |
| Appointments only | 3,669 |
| Chart header only | 2,553 |
| Registration only | 29 |

**Dated encounters.** A dated encounter is a distinct (patient, doctor, day) with at least one entry in `Co28`, `Clini_06`, `Co12_2` or `Co49_2`. There are **109,504** of them.

- 88,948 fall on the same day as an attended appointment.
- 102,500 attended-appointment days have no dated clinical entry. Their notes are probably only inside the `Co12_1` running text.

Which sources make up an encounter:

| Sources | Encounters |
|---|---|
| Document only | 40,617 |
| CID + evolution note | 22,272 |
| CID only | 21,890 |
| CID + prenatal | 10,655 |
| Prenatal only | 3,870 |
| Other combinations | 10,200 |

---

## 4. Mapping to Cortex

Target constraints are taken from `supabase/migrations` and `src/integrations/supabase/types.ts`:
- Patients belong to one doctor (`user_id`).
- A consultation, appointment or file must belong to the same doctor as its patient, enforced by composite foreign keys.
- No table has a legacy-ID or provenance column.
- `prescriptions` can only be written by the service role and requires an issued PDF.

### 4.1 Ownership: one Cortex patient per PersonalMed chart (recommended)

PersonalMed keeps a separate chart per doctor (`Clini_02`, and `UserNumber` on every clinical row). Cortex keeps a separate patient list per doctor. The recommended mapping is therefore **one Cortex `patients` row per `(PCod, UserNumber)` chart, owned by that doctor**:

- Each doctor's demographics are copied from `Clini_01`.
- Their consultations hold only their own notes, so authorship is preserved.
- Nobody sees another doctor's notes unless that doctor shares the chart through `patient_shares`.

Volumes:
- **34,796 patient rows** from `Clini_02`.
- Optionally up to 3,044 more for appointment-only pairs. Alternatively, import those appointments without a patient link.
- Per doctor: 2 → 6,406; 3 → 8,882; 4 → 10,170; 5 → 5,341; 9 → 3,266; 11 → 731.

The alternative is a single owner per patient, the doctor with the most activity:

| Owner | 2 | 3 | 4 | 5 | 9 | 11 |
|---|---|---|---|---|---|---|
| Patients | 6,152 | 8,524 | 9,689 | 5,032 | 2,894 | 562 |

Shares would then grant the other doctors access. **This is not recommended**: the other doctors' notes cannot be stored as their own, because the consultation→patient foreign key forces `user_id` to be the owner. About 4,150 patients would need 1–3 shares each. 87 owners would be decided by a tie-break on recency.

The 29 patients with registration only have no owner. The clinic must decide: skip them, or assign them to one doctor.

### 4.2 `patients`

| Cortex column | Source | Transformation |
|---|---|---|
| `id` | `(PCod, UserNumber)` | Deterministic UUIDv5 under a migration namespace, e.g. `pm:patient:{PCod}:{UserNumber}`. Re-runs are idempotent. |
| `user_id` | `UserNumber` → doctor's Cortex `auth.users.id` | Mapping table filled in by the owner |
| `name` | `Clini_01.Name` | Trim and collapse spaces. Optionally title-case for pt-BR, keeping particles such as da/de/do/dos/e. Flag the 1,038 names that contain digits for review. |
| `date_of_birth` | `BirthDate` | Datetime to date. 11.2% are null, which Cortex allows; none are in the future. |
| `age` | — | Leave null; the app computes it from `date_of_birth`. |
| `phone` | `Phone`, otherwise `DDDCellular` + `Cellular` | Normalise digits. Most numbers are 8 digits with no area code, so add `41` only if the owner approves. Keep the raw value if it can't be parsed. |
| `email` | `EMail` | Import only the 879 well-formed addresses. |
| `profession` | `Occupation` | Copy as-is. |
| `status` | derived | `retorno` if the chart has at least one consultation, otherwise `novo`. NOT NULL with a CHECK. |
| `last_visit` | max(consultation date, attended appointment date) | Set explicitly. The app normally maintains it through `complete_consultation_metadata`. |
| `diagnoses` | `Co12_2` | Distinct `{code, description}` per chart, in CID-10 shape. |
| `allergies` | — | `{}`. There is no structured source. The `Attention` text goes into `clinical_notes` for the doctor to review. |
| `medications` | — | `[]`. There is no structured list; prescriptions are free text. |
| `clinical_notes` | `Attention` + `Observation` | RTF → text, under a heading such as `[PersonalMed — Atenção]`. |
| `medical_history` | `Me` pages that are history, not a single visit ("Antecedentes", "Histórico Pessoal", "Aborto Habitual", "Exam Infertilidade/Menopausa", "Preventivos", "Estética") plus summaries of `Co50` (contraception), `Co51` (climacteric) and `Co53`/`CO55` | RTF → text, one section per page using that doctor's title from `Us04`. |
| `social_anamnesis` | `Me` page "Hábitos" (urologist); optionally `CivilStatus` | Text |
| `photo_url` | — | Skip; only 2 photos are flagged. |

**No Cortex column exists for:** CPF (in `FAX`), sex, RG, address, parents' names, place of birth, blood type, referral source or health-plan card. See §4.8.

### 4.3 `consultations`

Rows are inserted only; nothing is updated afterwards, so the revision and audit triggers never fire.

| Source | Cortex consultation | Volume |
|---|---|---|
| One dated encounter `(PCod, UserNumber, day)` from `Co28`, `Clini_06`, `Co12_2` or `Co49_2` | One consultation. `created_at` is the appointment start if one matches that day, otherwise the date at 12:00 America/Sao_Paulo. `soap_note` is Markdown with sections: Evolução (RTF→text), Sinais vitais (weight, height, heart rate, blood pressure), Pré-natal (gestational age, weight, blood pressure, fundal height, fetal heart rate, fetal movements, edema), CID, Documentos emitidos (full text of each Receita/Texto/Sol. exames). `appointment_id` is set when an attended appointment exists the same day. `chief_complaint` is a short label such as "Consulta (importada do PersonalMed)". | 109,504 (88,948 linked to an appointment) |
| `Co12_1` running text, one per chart | One consultation per chart, titled "Histórico PersonalMed (texto corrido)". `created_at` is `LastMedAdvice` or the latest date stamp in the text. The full text goes in `soap_note`. Do not split by date stamps automatically; that could be offered later with doctor review. | 26,407 |
| `Me` page 201 "QP/HDA" | One consultation dated `FirstMedAdvice`, or append to `medical_history`. Owner to decide. | 13,010 |

`transcription`, `whatsapp_message` and `pre_briefing` stay null. `history_proposals` stays `{}`.

### 4.4 `appointments`

| Cortex | Source / rule |
|---|---|
| `id` | UUIDv5 of `(UserNumber, Data, Inicio)` |
| `start_time` | `Data` + `Inicio`, read as wall-clock time in America/Sao_Paulo. Convert with the IANA tz database: Brazil observed daylight saving time until 2019. |
| `end_time` | start + `age03.Duracao`; 15 minutes if 0 or missing |
| `patient_id` | The chart patient from §4.1 for `(PCod, UserNumber)`. Null for pre-registered appointments and for doctors with no chart. |
| `title` | Appointment type label (`age02.Descricao`). Pre-registered appointments use the `PreCadastro` name instead. |
| `type` | RET → `retorno`. CONS → `novo` on the first appointment of the chart, otherwise `retorno`. Anything else → `seguimento`, with the original label in `notes`. |
| `status` | T, A, E → `realizado`. C → `cancelado`. F → `cancelado` with `notes` "Falta"; Cortex has no no-show status. `-` in the future → `agendado`. `-` in the past → owner to decide. |
| `notes` | `age03.Obs` and the original status code |
| `google_*` | Defaults. Inserts are not queued for Google Calendar sync. |

Volume: 273,794 in all. The recommended default is to import every future appointment plus a chosen number of past years; see open question 4.

`age01` and `age05` (doctor day notes and reminders) and `Age09` (walk-in queue up to 2011) have no target.

### 4.5 `patient_files` (bucket `patient-files`, 25 MB limit)

- **Embedded images:**
  - 20 JPEGs in `Clini_04`: copy as they are.
  - 27 BMPs in `Co31_1`, `Co31_3` and `Co31_7`, and 19 in `CO52`: convert to PNG, because the app accepts pdf, jpeg, png, webp and heic.
  - Path: `patients/{user_id}/{patient_id}/{uuid}-{sourceKey}.png`. Tag `importado-personalmed`.
  - Leave `ai_summary` null, so the files don't show up as AI proposals.
- **152 `Clini_04` rows point to image files outside the export** (a stored path and location). The clinic must provide that folder.
- Optional: render each `Clini_06` document to PDF. That is 72,565 files and probably several GB, so it is not recommended; the text already goes into the consultations.

### 4.6 `prescriptions` (including exam requests)

**Do not write to it.** That table is for documents issued and verified in Cortex: it requires the service role, a PDF at `rx/{user}/{id}.pdf`, `secret_code`, `expires_at` and an immutable `issuance_snapshot`. Historical prescriptions and exam requests are imported as text in the consultation for that day (§4.3).

### 4.7 Provenance: `clinical_work_items`, `clinical_record_revisions`, audit

- `clinical_record_revisions` is written only by update triggers, so an insert-only load creates no revisions. That is the intended outcome.
- `clinical_work_items`: optionally create `pregnancy` items for **current pregnancies only**, that is the 66 rows with `DPP` in the future:
  - `details.date` = DPP
  - `details.source` = "DUM" or "USG" (from `DppEcos`)
  - status `open`

  Historical prenatal data goes into consultation text.
- Provenance: no column exists. The recommendations are:
  - a visible prefix in the imported text, `[Importado do PersonalMed 2005 em AAAA-MM-DD]`;
  - deterministic UUIDs;
  - **a small migration adding a service-role-only `legacy_import_map` table**: `(batch_id, source_table, source_key, target_table, target_id, imported_at)`. It makes reconciliation, LGPD access requests and rollback auditable.
- Audit: write one `chart_access_audit` row per chart with `action='legacy_import'`, using the operator's id as the actor.

### 4.8 Data with no home in Cortex today

| Data | Volume | Recommendation |
|---|---|---|
| CPF (in `FAX`), sex, RG, address, parents' names, place of birth, blood type | 8.2k valid CPFs; most others 40–90% filled | Ask the owner. CPF and sex are useful for prescriptions and gynecology; add columns only if the clinic needs them. The rest: archive, don't migrate (data minimisation). |
| Health plans: `Carrier` (25), per-patient cards `Clini_05` (62,204), `Age04.CarrierCod` | — | Archive read-only. If scheduling needs the plan, add `patients.health_plan` and `health_plan_card` in a new migration. |
| Financial: `Financas` (1,652), `fin_*`, `Fin_*` | Small | **Ignore**; keep in the encrypted archive. |
| TISS / Unimed / AMB / CBHPM / CIEFAS / LPM procedure tables | Reference data | Ignore. |
| Drug database `Def`/`DefMA`, `Cid9`/`Cid10`, CBO tables | Reference data | Ignore. Cortex has its own medication catalogue, and CID codes are stored inline. |
| Text templates `Us05` (743 prescriptions, 297 texts, 51 exam requests), `Gintxt`, `Pedtxt` | 1,123 | Optional. Cortex `document_templates` are print layouts, not text snippets, so archive these or wait for a snippets feature. |
| Agenda notes `age01`/`age05`, phone book `AgFone`, `Messages` | 12k / 8k / 924 / 77 | Ignore. They are not part of the medical record and contain third-party data. |
| Specialty modules with almost no data (`Co31*`, `CO43`, `Co53*`, `CO54*`, `CO55*`, `Clini_08`) | &lt; 300 rows | Render as text into the consultation for that date or into `medical_history`. |
| Staff credentials (`Us01.Pass`, `Cfg08`, `US12`) | — | **Never migrate**; see §6. |

The whole export must also be kept as an **encrypted read-only archive**. Brazilian rules (Lei 13.787/2018; CFM Resolution 1.821/2007) require medical records to be kept for at least 20 years from the last entry, and the legacy charts remain the legal record of the past care.

### 4.9 Required transformations

- **Code pages.** Paradox alpha and memo fields are cp1252, except the 5 cp437 reference tables. SQL `varchar` is cp1252 and `ntext` is UTF-16. All of these are handled by the readers.
- **RTF to text.** Delphi TRichEdit output: `\'hh` escapes in cp1252, `\par`, font and colour tables. Converter: `scripts/personalmed/rtf-to-text.mjs`. No embedded pictures were found in any RTF memo. To verify:
  - sample the output with the doctors before loading;
  - check that RTF with tables and lists keeps its line breaks.
- **Dates.**
  - Paradox Date = days since 0001-01-01; Paradox Time = milliseconds since midnight; Paradox Timestamp = milliseconds since 0001-01-01.
  - SQL `datetime` = days since 1900-01-01 plus 1/300-second ticks.
  - Treat the Delphi zero date 1899-12-30 as null. It appears in `FirstMedAdvice` (72), `ReturnMedAdvice` (33,037), `Co49_1.Parturition` (4,489) and `PDPECO` (3,579).
  - All values are local wall-clock time in America/Sao_Paulo.
- **Names.**
  - 95% are upper case.
  - 1,038 contain digits or time annotations.
  - 181 are a single word.
  - Do not split into first and last name; Cortex has a single `name` field.
- **Phones.** Mixed formats with no area code. Normalise to digits; keep the raw value when ambiguous.
- **Pre-registration blob.** Decode the `Age04.PreCadastro` shortstrings at offsets 0, 256 and 512 for appointment titles.

---

## 5. Data quality

All figures are counts only.

**Patients (`Clini_01`, 32,882 rows)**
- Birth date:
  - 3,692 missing (11.2%).
  - 0 in the future and 0 before 1900.
  - 2 imply an age over 110.
  - By age: 0–17: 354; 18–39: 8,297; 40–64: 15,863; 65–89: 4,373; 90–110: 301.
- Sex missing: 8,097 (24.6%).
- No phone or mobile: 1,078.
- E-mail field: 7,692 of 8,592 values are not e-mail addresses.
- **Possible duplicates.** Names are compared after removing accents and collapsing spaces.

  | Duplicate rule | Groups | Rows |
  |---|---|---|
  | Same name | 137 | 278 |
  | Same name + birth date | 45 | 90 |
  | Same RG | 116 | 235 |
  | Same valid CPF (`FAX`) | 27 | 55 |
  | Same mother + birth date | 46 | 92 |

  Do not merge automatically: under the per-chart model a "duplicate" may belong to different doctors. Give the clinic a review list, produced locally and not stored in the repo.
- The `FAX`/CPF column has 251 eleven-digit values that fail the checksum, and other non-CPF content. The largest group of identical `FAX` values is 332 rows: a placeholder or a real fax number.

**Orphans**
- 1 `Co12_1` row and 2 attended `Age04` rows point to patients that don't exist.
- 52 `Age04` rows have no `age03` slot.
- 0 orphans in `Clini_02`, `Me`, `Co28`, `Clini_06` and `Co12_2`.

**Invalid or out-of-range values**
- `Clini_02.FirstMedAdvice`: 1 in 2088.
- `Clini_05.ExpirationDate`: 71 invalid, with values up to 2099.
- `Co28.Height` outliers up to 10,060.
- `Co28.Temperature` is 0 in 99%.
- `Co49_1.DUM` has a 1899 sentinel.
- `Financas.DataVencimento` goes up to 2055.

**Agenda statuses never closed**
- 1,635 `A` (arrived but never started) and 266 `E` (in progress) in the past.
- 16,881 past appointments with no status.

**Integrity notes**
- `Problems.txt`, written at export time, reports one error in `age04.db`: an invalid record number while moving a block. The reader read all 273,794 rows, and the header count equals the block chain. Recheck this table after the clinic's final export.
- One LOB value could not be decoded: an `Attention` value with a bad slot pointer. Every other LOB passed the size and UTF-16 checks.

---

## 6. Migration plan

**Principles**
- Read-only on the source.
- No PHI in the repo, logs or CI.
- Deterministic IDs.
- Insert-only.
- Small per-doctor batches. `guard_clinical_write` takes a per-doctor advisory lock, so one long transaction would block that doctor in the app.
- Every step can be repeated and reversed.

### 6.1 Steps

1. **Freeze and secure the source.**
   - Keep the original `.rar` and its SHA-256 hash.
   - Work on a copy in an encrypted folder on the owner's machine.
   - Never put the export in the repo, cloud chats, CI or the AI provider.
   - The export includes staff passwords: treat it as a secret and rotate any password that is reused elsewhere.
   - Plan a **final export at cut-over** and stop writes to PersonalMed during it.
2. **Cross-check the SQL Server reader** (needs owner approval: it means loading into a database).
   - Restore `PersonalMed2005.bkp` on an **offline, isolated** SQL Server 2005/2008 R2 instance. SQL Server 2012 and later cannot restore SQL 2000 backups directly.
   - Compare row counts and key sets with `mssql2000-reader.mjs`.
   - If no compatible server is available, the reader's own checks stand: catalogue consistency, 0 null-bitmap mismatches, LOB size and UTF-16 checks, and 100% key joins.
3. **Extract to staging.**
   - A local extractor turns the readers' output into NDJSON or Parquet, or loads a disposable local Postgres (after approval).
   - It writes to an encrypted staging folder outside the repo.
   - Staging keeps the source keys and the raw RTF.
4. **Transform** with pure functions and unit tests on synthetic fixtures:
   - RTF → text;
   - date and time zone handling;
   - names and phones;
   - encounter assembly (§4.3), charts (§4.1), appointments (§4.4) and images (BMP → PNG);
   - deterministic UUIDv5 values;
   - output as one JSON per doctor batch.
5. **Dry run and reconciliation.** Produce a counts-only report and compare it with the expected totals:

   | Item | Expected |
   |---|---|
   | Chart patients | 34,796 (per doctor 6,406 / 8,882 / 10,170 / 5,341 / 3,266 / 731) |
   | Dated encounters | 109,504 |
   | History consultations | 26,407 |
   | Appointments | 273,794, or the chosen subset |
   | Embedded images | 66 |
   | CID codes | 63,062 rows → distinct codes per chart |
   | Characters | Total characters before and after RTF stripping, per table |

   Every difference needs an explanation, such as orphans or sentinels. In addition, **each doctor reviews a sample of their charts** side by side in a staging Cortex.
6. **Load to staging Supabase** (per the remediation runbook; synthetic accounts first, then real doctors' staging accounts).
   - Use the service role, in batches of a few hundred rows per doctor, in this order: patients → appointments → consultations (with `appointment_id`) → files (Storage only after the patient exists) → work items → audit rows.
   - Use `ON CONFLICT (id) DO NOTHING`.
   - Record every row in `legacy_import_map`.
   - Re-runs are safe.
7. **Verify on staging.**
   - Counts match the reconciliation report.
   - RLS is correct: each doctor sees only their own charts, and shares work.
   - `last_visit` and `status` are correct.
   - Calendar performance holds with the chosen appointment volume.
   - No Google sync and no AI processing is triggered by the import.
   - The UI renders the longest notes (19k characters).
8. **Production load**, with the owner's sign-off and a backup taken immediately before.
   - Same batches, off-hours, one doctor at a time.
   - **Rollback:** delete by `legacy_import_map.batch_id`. Use the service role and the existing deletion preflight, files first. Or restore the pre-load backup.
9. **After cut-over.**
   - PersonalMed becomes read-only.
   - The encrypted archive is kept for 20 years.
   - Staging extracts are securely deleted.
   - The import is recorded in the privacy and operations documentation.

**AI.** AI features are enabled in production. Imported history will become context when doctors use them. The clinic must decide whether legacy notes may be sent to the AI provider, and the bulk import itself must never call AI endpoints.

### 6.2 Open questions for the owner

1. **Doctors.**
   - Which PersonalMed accounts (2, 3, 4, 5, 9, 11) map to which Cortex accounts?
   - Will they all use Cortex?
   - Should secretaries' agenda notes be ignored?
2. **Ownership.** Confirm one patient per doctor's chart, as in §4.1. Should doctors share charts with each other by default (read or contribute), or only on request?
3. **History depth.** Import every chart, or only active patients? By date of last activity:

   | Last activity | Patients |
   |---|---|
   | 2025 or later | 9,178 |
   | 2021 or later | 15,560 |
   | 2016 or later | 21,951 |
   | 2011 or later | 28,036 |
   | All | 32,853 |

4. **Appointments.**
   - Future only (1,024), the last N years, or all 273,794?
   - Include the 65k pre-registered appointments that have no patient?
   - What should past appointments with no status become?
5. **Code meanings.** Confirm `Estado` C, F, A, E and `-`, `age03.Tipo` C, B and P, and the mapping of appointment types to Cortex types.
6. **Extra patient fields.**
   - Is the CPF really stored in the "FAX" field?
   - Add CPF, sex or health plan to Cortex, or leave them in the archive?
   - What is the e-mail field really used for?
7. **"Atenção" alerts** (5,442 patients). Import them as text in `clinical_notes` for doctors to review, or have them turned into structured allergies after confirmation?
8. **Images.**
   - Where are the 152 external image files referenced by `Clini_04`?
   - Are there other folders, such as scanned exams or PDFs, outside this export?
9. **Financial and health-plan data.** Confirm "do not migrate, archive only".
10. **Text templates** (`Us05`, 1,091). Wanted in Cortex?
11. **Cut-over.**
    - Date, and whether PersonalMed stays in use until then.
    - Re-run strategy: deterministic IDs make re-imports idempotent. Edits made in PersonalMed after the first load are not picked up unless the delta is handled.
12. **LGPD.** Legal basis and patient notice for the system change, who may operate the import, and where the archive is kept.
13. **Provenance table.** Approve the small `legacy_import_map` migration.

### 6.3 Rough effort

These are engineering days, excluding the clinic's review time.

| Work | Days |
|---|---|
| Readers, inventory and linkage analysis | done |
| Staging extractor and fixtures | 2–3 |
| Transforms: RTF, encounters, appointments, images, IDs; plus tests | 5–7 |
| Loader: batching, idempotency, provenance map, rollback, reconciliation report | 3–4 |
| Staging dry runs, doctor review rounds, fixes | 4–6 |
| Production cut-over and verification | 1–2 |
| **Total** | **≈ 3–4 weeks** |

Add 1–2 days if new patient columns (CPF, sex, health plan) or an external image folder are in scope.

---

## 7. Biggest risks

1. **Two source stores.** The patient master is in a SQL Server 2000 file that is read with a custom parser. Cross-check it against a restored `.bkp` if at all possible (§6.1 step 2).
2. **Unstructured clinical text.** Much of the history (`Co12_1`, `Me`) is a running RTF log. It imports faithfully as text, but cannot become structured data without manual or AI-assisted review.
3. **Inferred codes.** Appointment status, slot type and the CPF-in-FAX reuse need the clinic's confirmation.
4. **Live source.** The export was taken from a running system, with files modified up to the export minute. Plan a final, quiescent export at cut-over.
5. **Volume.** About 35k patients, about 136k consultations and up to 274k appointments. Per-doctor locks and calendar performance mean the load must be batched; consider limiting the appointment history.
6. **Privacy.** The export holds sensitive health data, third-party names (parents, referrers, phone book) and staff credentials. Apply strict handling, minimisation and secure deletion of intermediate files.

---

## 8. Tooling

All tools are dependency-free Node 22+ ES modules in `scripts/personalmed/`. They read the export folder passed as an argument and never write to it. Run them from the repo, never from inside the export folder.

| Script | Purpose |
|---|---|
| `paradox-reader.mjs` | Paradox 3–7 reader. Handles the header (record and header size, block size, field types and names, sort order, code page, encryption flags) and walks the block chain. Decodes alpha, date, short, long, autoinc, number, currency (sign-flipped big-endian), logical, time, timestamp, BCD and bytes, and memo/fmtmemo/blob/graphic/ole through the `.MB` file (single and sub-allocated blocks). Includes cp437, cp850, cp860 and cp1252 decoders. Detects encrypted tables and does not try to decrypt them. |
| `mssql2000-reader.mjs` | Read-only SQL Server 2000 `.mdf` reader. Restores torn-page bits, checks page allocation via PFS, reads the catalogue (`sysobjects`, `syscolumns`, `sysindexes`), parses FixedVar records with null bitmaps, and decodes text/ntext/image LOBs (root, internal, data and indirection structures, all verified against this file). |
| `rtf-to-text.mjs` | Minimal RTF to text converter that also counts embedded pictures and objects. |
| `inventory.mjs` | Schema listing and aggregates: stats, joins (including composite keys), duplicates, cross-tabs with k ≥ 5 suppression, code-page check, and `--lookup` for configuration tables only. Prints no values. |
| `linkage.mjs` | Per-doctor volumes, coverage, the ownership simulation, encounter synthesis, last-activity histogram and patient quality checks. Counts only. |

Examples:

```sh
node scripts/personalmed/inventory.mjs "<export>"                       # schemas (Paradox + .mdf)
node scripts/personalmed/inventory.mjs "<export>" --stats Clini_01 Age04
node scripts/personalmed/inventory.mjs "<export>" --join Age04.PCod=Clini_01.PCod --dupes Clini_01:Name+BirthDate
node scripts/personalmed/inventory.mjs "<export>" --charset
node scripts/personalmed/linkage.mjs   "<export>"
```

How the readers were validated:
- Header counts match block chains on all 406 tables.
- Computed record sizes match the headers.
- The code-page check in §1.1.
- After torn-bit restoration, all 32,882 `Clini_01` records parse with the expected column count; before it, 2,195 failed.
- No variable-length column with its null bit set carries data.
- Every multi-link LOB passes its size check.
