"""Count data rows in an xlsx sheet straight from the XML, without DuckDB.

Used by the row count check as the "raw rows" side. A data row is a <row> after the
header that has at least one cell with a value. DOL files carry hundreds of thousands
of formatted but empty rows at the bottom; those are counted separately so the
manifest shows both numbers.
"""

from __future__ import annotations

import zipfile
from dataclasses import dataclass
from pathlib import Path
from xml.etree.ElementTree import iterparse

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


@dataclass
class SheetCount:
    data_rows: int  # rows after the header with at least one non-empty cell
    blank_rows: int  # <row> elements after the header with no values
    last_data_row: int  # 1-based sheet row number of the last data row
    first_blank_row: int | None  # first blank row number, to show blanks are trailing


def read_header(path: Path, sheet: str = "xl/worksheets/sheet1.xml") -> list[str]:
    """Return the header row's cell text, in column order."""
    cells: list[tuple[str, str]] = []  # (type, raw value)
    with zipfile.ZipFile(path) as z:
        with z.open(sheet) as f:
            for _, el in iterparse(f, events=("end",)):
                if el.tag == NS + "row":
                    for c in el.iter(NS + "c"):
                        v = c.find(NS + "v")
                        t = c.find(f"{NS}is/{NS}t")
                        if c.get("t") == "inlineStr" and t is not None:
                            cells.append(("str", t.text or ""))
                        else:
                            cells.append((c.get("t", "n"), v.text if v is not None else ""))
                    break
        wanted = {int(v) for t, v in cells if t == "s"}
        strings: dict[int, str] = {}
        if wanted:
            with z.open("xl/sharedStrings.xml") as f:
                i = 0
                for _, el in iterparse(f, events=("end",)):
                    if el.tag == NS + "si":
                        if i in wanted:
                            strings[i] = "".join(t.text or "" for t in el.iter(NS + "t"))
                            if len(strings) == len(wanted):
                                break
                        i += 1
                        el.clear()
    return [strings[int(v)] if t == "s" else v for t, v in cells]


def count_rows(path: Path, sheet: str = "xl/worksheets/sheet1.xml") -> SheetCount:
    data = blank = last = 0
    first_blank = None
    with zipfile.ZipFile(path) as z, z.open(sheet) as f:
        for _, el in iterparse(f, events=("end",)):
            if el.tag != NS + "row":
                continue
            r = int(el.get("r"))
            if r > 1:
                has_value = any(
                    (c.find(NS + "v") is not None and c.find(NS + "v").text)
                    or c.find(NS + "is") is not None
                    for c in el.iter(NS + "c")
                )
                if has_value:
                    data += 1
                    last = r
                else:
                    blank += 1
                    if first_blank is None:
                        first_blank = r
            el.clear()
    return SheetCount(data, blank, last, first_blank)
