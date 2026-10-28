"""Tiny helper for the emulator smoke test: read the screen with uiautomator and find text.

    python3 ui.py texts  ui.xml            -> every visible text, one per line
    python3 ui.py center ui.xml "Label"    -> "x y" of the element whose text, description or hint is "Label"
                                              (exact match first, then starts-with, then contains;
                                              bottom-most wins, for tab bars)
"""
import sys
import xml.etree.ElementTree as ET


def nodes(path):
    for n in ET.parse(path).iter("node"):
        label = (n.get("text") or n.get("content-desc") or n.get("hint") or "").strip()
        b = n.get("bounds", "")
        if not label or not b:
            continue
        (x1, y1), (x2, y2) = [tuple(map(int, p.split(","))) for p in b.strip("[]").split("][")]
        if x2 > x1 and y2 > y1:
            yield label, (x1 + x2) // 2, (y1 + y2) // 2


def main():
    cmd, path = sys.argv[1], sys.argv[2]
    found = list(nodes(path))
    if cmd == "texts":
        print("\n".join(label for label, _, _ in found))
        return
    want = sys.argv[3]
    hits = (
        [f for f in found if f[0] == want]
        or [f for f in found if f[0].startswith(want)]
        or [f for f in found if want in f[0]]
    )
    if not hits:
        sys.exit(1)
    _, x, y = max(hits, key=lambda f: f[2])
    print(x, y)


main()
