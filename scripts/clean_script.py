#!/usr/bin/env python3
"""Clean up OCR-extracted Annie Jr script and apply structured formatting."""
from __future__ import annotations

import re
from pathlib import Path

INPUT = Path(__file__).parent / "annie_jr_script.txt"
OUTPUT = Path(__file__).parent / "annie_jr_script_clean.txt"

SONG_TITLES = {
    "MAYBE",
    "IT'S THE HARD-KNOCK LIFE",
    "IT'S THE HARD-KNOCK LIFE (REPRISE)",
    "TOMORROW",
    "LITTLE GIRLS",
    "I THINK I'M GONNA LIKE IT HERE",
    "N.Y.C.",
    "EASY STREET",
    "YOU'RE NEVER FULLY DRESSED WITHOUT A SMILE",
    "YOU'RE NEVER FULLY DRESSED WITHOUT A SMILE (REPRISE)",
    "A NEW DEAL FOR CHRISTMAS",
    "SOMETHING WAS MISSING",
    "I DON'T NEED ANYTHING BUT YOU",
    "ENTR'ACTE",
}

# Musical tempo/expression words that appear as standalone lines in notation
MUSIC_DIRECTIONS = {
    "sweetly", "moderato", "allegro", "andante", "rit", "rit.", "ritardando",
    "a tempo", "a tempo!", "con brio", "broadly", "bright", "brightly",
    "triumphantly", "slowly", "slowly in 4", "moderato in 4", "moderato in 2",
    "in 4", "in 2", "gospel feel",
}

NOISE_RE = re.compile(
    r"^(--- p\d+"
    r"|Music Theatre"
    r"|Broadway Junior"
    r"|Director'?s Guide"
    r"|\d+\s*$"
    r"|THE END"
    r").*",
    re.IGNORECASE,
)

# Patterns that indicate musical notation lines
SYLLABLE_RE = re.compile(r"\w+\s*-\s*\w+")          # "May - be", "sit-tin'"
MEASURE_NUM_RE = re.compile(r"^\d+\s+[A-Za-z\[#]")  # "13 MOLLY:" or "23 [box]"
BRACKET_NUM_RE = re.compile(r"\[\d+\]")              # "[73]" measure markers
MOSTLY_SYMBOL_RE = re.compile(r"^[\s\d\-=_|#@~^<>\\/*+°]+$")

CHAR_NAME_RE = re.compile(r"^([A-Z][A-Z ,\.\'\-]+)$")
INLINE_CHAR_RE = re.compile(r"^([A-Z][A-Z ,\.\'\-]+):\s*(.*)")
SCENE_RE = re.compile(r"^(SCENE|ACT)\s+\w+")


def is_noise(s: str) -> bool:
    return bool(NOISE_RE.match(s))


def is_notation(s: str) -> bool:
    if not s or len(s) < 2:
        return True
    if MOSTLY_SYMBOL_RE.match(s):
        return True
    if MEASURE_NUM_RE.match(s):
        return True
    if BRACKET_NUM_RE.search(s):
        return True
    if s.lower() in MUSIC_DIRECTIONS:
        return True
    # Low alpha ratio
    alpha = sum(c.isalpha() for c in s)
    if len(s) > 6 and alpha / len(s) < 0.35:
        return True
    # 2+ hyphenated syllable groups strongly suggests musical notation
    if len(SYLLABLE_RE.findall(s)) >= 2:
        return True
    return False


def is_song_title(s: str) -> bool:
    return s in SONG_TITLES


def is_scene_heading(s: str) -> bool:
    return bool(SCENE_RE.match(s))


def is_char_name(s: str) -> bool:
    return (
        bool(CHAR_NAME_RE.match(s))
        and not is_scene_heading(s)
        and not is_song_title(s)
    )


# Abbreviations that end with a period but should NOT trigger a line split
ABBREV_RE = re.compile(
    r"\b(Mr|Mrs|Ms|Dr|St|Jr|Sr|Lt|Sgt|No|vs|etc|a\.m|p\.m)\.$",
    re.IGNORECASE,
)


def split_dialogue(line: str) -> list[str]:
    """Split a dialogue line at commas and sentence-ending periods."""
    # Split after every comma or period that is followed by whitespace
    raw = re.split(r"(?<=[,\.]) +", line)
    # Re-join any part that ended with a known abbreviation (was split in error)
    merged: list[str] = []
    for part in raw:
        if merged and ABBREV_RE.search(merged[-1]):
            merged[-1] = merged[-1] + " " + part
        else:
            merged.append(part)
    return [p.strip() for p in merged if p.strip()]


def split_dialogue_lines(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if line and not line.startswith("##"):
            out.extend(split_dialogue(line))
        else:
            out.append(line)
    return out


def strip_quotes(s: str) -> str:
    if len(s) >= 2 and s[0] in ('"', '“') and s[-1] in ('"', '”'):
        return s[1:-1]
    return s


# ── Phase 1: strip noise, remove notation, join wrapped lines ──────────────

def unwrap(raw_lines: list[str]) -> list[str]:
    """One logical line per entry; wrapped continuations are joined."""
    out: list[str] = []

    for raw in raw_lines:
        s = raw.strip()

        if not s or is_noise(s) or is_notation(s):
            out.append("")
            continue

        # Determine whether this line starts a new logical block
        starts_new = (
            s.startswith("(")
            or is_char_name(s)
            or is_scene_heading(s)
            or is_song_title(s)
            or bool(INLINE_CHAR_RE.match(s))
        )

        if not out or out[-1] == "" or starts_new:
            out.append(s)
        elif is_char_name(out[-1]):
            # Previous line is a standalone character name: dialogue goes on
            # its own line so the tagging phase can fold them together.
            out.append(s)
        elif out[-1].startswith("(") and out[-1].endswith(")"):
            # Previous was a complete (closed) stage direction: new speech.
            out.append(s)
        else:
            # Continuation of a wrapped line (dialogue or open stage dir)
            out[-1] = out[-1] + " " + s

    return out


# ── Phase 2: tag lines ─────────────────────────────────────────────────────

def tag(lines: list[str]) -> list[str]:
    out: list[str] = []
    i = 0

    while i < len(lines):
        s = lines[i]
        i += 1

        if not s:
            out.append("")
            continue

        # Stage direction
        if s.startswith("("):
            out.append(f"##STAGE {s}")
            continue

        # Scene heading — strip the leading "SCENE "/"ACT " word since ##SCENE conveys it
        if is_scene_heading(s):
            label = re.sub(r"^(SCENE|ACT)\s+", "", s)
            out.append(f"##SCENE {label}")
            continue

        # Song title — keep verbatim
        if is_song_title(s):
            out.append(s)
            continue

        # Inline "NAME: dialogue" or "NAME: (stage dir)"
        inline = INLINE_CHAR_RE.match(s)
        if inline:
            name = inline.group(1).strip()
            rest = inline.group(2).strip()
            out.append(f"##CHARACTER {name} SAYS:")
            if rest.startswith("("):
                out.append(f"##STAGE {rest}")
            elif rest:
                out.append(strip_quotes(rest))
            continue

        # Standalone character name — peek at next non-empty line
        if is_char_name(s):
            name = s.strip()
            j = i
            while j < len(lines) and not lines[j]:
                j += 1
            nxt = lines[j] if j < len(lines) else ""
            out.append(f"##CHARACTER {name} SAYS:")
            if (
                nxt
                and not nxt.startswith("(")
                and not is_char_name(nxt)
                and not is_scene_heading(nxt)
                and not is_song_title(nxt)
                and not INLINE_CHAR_RE.match(nxt)
            ):
                out.append(strip_quotes(nxt))
                i = j + 1
            continue

        # Plain dialogue
        out.append(strip_quotes(s))

    return out


# ── Phase 3: collapse blank runs ───────────────────────────────────────────

def collapse_blanks(lines: list[str]) -> list[str]:
    out: list[str] = []
    blank_run = 0
    for ln in lines:
        if ln == "":
            blank_run += 1
            if blank_run <= 1:
                out.append(ln)
        else:
            blank_run = 0
            out.append(ln)
    return out


def main() -> None:
    raw_lines = INPUT.read_text(encoding="utf-8").splitlines()
    unwrapped = unwrap(raw_lines)
    tagged = tag(unwrapped)
    split = split_dialogue_lines(tagged)
    final = collapse_blanks(split)

    OUTPUT.write_text("\n".join(final).strip() + "\n", encoding="utf-8")

    char_lines = sum(1 for l in final if l.startswith("##CHARACTER"))
    stage_lines = sum(1 for l in final if l.startswith("##STAGE"))
    print(f"Done → {OUTPUT}")
    print(f"  {len(final)} lines  |  {char_lines} ##CHARACTER  |  {stage_lines} ##STAGE")


if __name__ == "__main__":
    main()
