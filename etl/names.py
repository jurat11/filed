"""Employer name normalization, used for matching only (never for display).

Steps, in order:
1. Uppercase and fold accents to ASCII.
2. Cut anything after a "DBA" / "D/B/A" marker (the legal name comes first).
3. Drop connectors: "&", "+" and the word "AND" all become a space, so "AT&T",
   "AT & T" and "AT and T" agree, and "ERNST YOUNG US LLP" (as USCIS writes it) matches
   "Ernst & Young U.S. LLP".
4. Delete periods and apostrophes (so "L.L.C." -> "LLC", "MACY'S" -> "MACYS"),
   and turn every other non-alphanumeric character into a space.
5. Collapse spaces.
6. Remove legal-form tokens from the end (repeatedly, so "CO LTD" goes too) and a
   leading "THE".

The suffix list is the one in the spec plus a few long forms of the same words
(INCORPORATED, LIMITED, COMPANY) and "PC"; see docs/decisions.md.
"""

from __future__ import annotations

import re
import unicodedata

SUFFIXES: frozenset[str] = frozenset(
    {
        "INC", "LLC", "LLP", "CORP", "CORPORATION", "CO", "LTD", "LP", "PLLC",
        "INCORPORATED", "LIMITED", "COMPANY", "PC",
    }
)  # fmt: skip

_DBA_RE = re.compile(r"\s(?:D\s*/\s*B\s*/\s*A|DBA)\b.*$")
_JOIN_RE = re.compile(r"[.'’`]")
_OTHER_RE = re.compile(r"[^A-Z0-9 ]+")
_SPACE_RE = re.compile(r"\s+")


def normalize_name(name: str | None) -> str:
    if not name:
        return ""
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = s.upper()
    s = _DBA_RE.sub("", s)
    s = s.replace("&", " ").replace("+", " ")
    s = _JOIN_RE.sub("", s)
    s = _OTHER_RE.sub(" ", s)
    tokens = [t for t in _SPACE_RE.sub(" ", s).strip().split(" ") if t != "AND"] or ["AND"]
    while len(tokens) > 1 and tokens[-1] in SUFFIXES:
        tokens.pop()
    if len(tokens) > 1 and tokens[0] == "THE":
        tokens.pop(0)
    return " ".join(t for t in tokens if t)
