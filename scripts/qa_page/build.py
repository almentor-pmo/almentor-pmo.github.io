#!/usr/bin/env python3
"""Assemble quality/index.html from the shared almentor styles (index.html) + scripts/qa_page/*."""
import os, re, shutil
H = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(os.path.dirname(H))
pmo = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
css = pmo[pmo.index("<style>") + 7:pmo.index("</style>")]
logo = re.search(r'const LOGO_WHITE="([^"]+)"', pmo).group(1)
head = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow">
<title>almentor Quality Dashboard</title>
<link rel="icon" type="image/png" href="favicon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Kufi+Arabic:wght@400;600;700&display=swap">
<style>{css}
{open(os.path.join(H, "extra.css"), encoding="utf-8").read()}</style>
</head>
'''
body = open(os.path.join(H, "body.html"), encoding="utf-8").read().replace("{{LOGO}}", logo).replace("{{JS}}", open(os.path.join(H, "app.js"), encoding="utf-8").read())
os.makedirs(os.path.join(ROOT, "quality"), exist_ok=True)
open(os.path.join(ROOT, "quality", "index.html"), "w", encoding="utf-8").write(head + body)
shutil.copy(os.path.join(ROOT, "favicon.png"), os.path.join(ROOT, "quality", "favicon.png"))
print("quality/index.html", len(head + body))
