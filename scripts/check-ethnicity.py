import re
from pathlib import Path

text = Path(r"m:\项目\躺投\src\shared\catalogs\enums.ts").read_text(encoding="utf-8")
match = re.search(r"ETHNICITY_OPTIONS.*?=\s*\[(.*?)\];", text, re.S)
assert match
items = re.findall(r"labelZh: '([^']+)'", match.group(1))
print("count", len(items))
print("has_other", [item for item in items if "其他" in item])
print("\n".join(items))
