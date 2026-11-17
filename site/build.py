"""Build the website into site/_out (no dependencies). Run: python3 site/build.py

- index.html from index.template.html
- docs.html from ../GUIDE.md (docs.template.html)
- terms / privacy / trademarks / licenses from legal/*.md, 404 page (page.template.html)
- per-page SEO: title, description, canonical, Open Graph, X card, JSON-LD
- sitemap.xml + robots.txt

The site address comes from $URL (Netlify sets it to the live address at build time);
locally it falls back to http://127.0.0.1:8765. Preview: python3 -m http.server 8765 -d site/_out
"""
import datetime
import html
import json
import os
import re
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_out")
SITE = os.environ.get("URL", "http://127.0.0.1:8765").rstrip("/")
REPO = "https://github.com/thoshiranchanilka/After-Effects-Claude-MCP"
AUTHOR = {"@type": "Person", "name": "Thoshiran Chanilka", "url": "https://thecreator.vercel.app/"}
NAME = "After Effects × Claude MCP"
TODAY = datetime.date.today().isoformat()
STATIC = ["styles.css", "logo.svg", "og.png", "apple-touch-icon.png"]

PAGES = {
    "index.html": ("After Effects MCP server for Claude: AI motion design automation",
                   "Be the creative director and let Claude do the heavy lifting in Adobe After Effects: camera rigs, matched cuts, "
                   "text reveals, shape-built UI and frame checks, in your own motion style. Free and open source."),
    "docs.html": ("Guide: install and use the After Effects MCP server for Claude",
                  "Set up the After Effects × Claude MCP server with Claude Code or Claude Desktop: install, tools, ExtendScript "
                  "rules, custom style profiles and troubleshooting."),
    "terms.html": ("Terms of Use", "Terms for using the After Effects × Claude MCP website and open-source software."),
    "privacy.html": ("Privacy Policy", "No accounts, no cookies, no analytics: how the After Effects × Claude MCP website and software handle data."),
    "trademarks.html": ("Trademarks", "Trademark notices for Adobe, After Effects, Claude and other names mentioned on this site."),
    "licenses.html": ("Licences", "The Apache 2.0 licence of After Effects × Claude MCP and the open-source components it uses."),
    "404.html": ("Page not found", "This page doesn't exist."),
}
LEGAL = ["terms", "privacy", "trademarks", "licenses"]

NAV = """<header class="nav pad">
  <a class="brand" href="./"><img src="logo.svg" alt="">After Effects × Claude</a>
  <nav class="nav-links" aria-label="Main">
    <a href="./#capabilities">Capabilities</a>
    <a href="./#how">How it works</a>
    <a href="./#desktop">Claude Desktop</a>
    <a href="docs.html" class="keep">Docs</a>
  </nav>
  <a class="btn dark" href="%s">Get the code</a>
</header>""" % REPO

FOOTER = """<footer class="rule">
  <span>After Effects × Claude MCP</span>
  <span>Made by <a href="https://thecreator.vercel.app/" target="_blank" rel="noopener">Thoshiran Chanilka</a> with love for creators</span>
  <nav class="legal-links" aria-label="Legal">
    <a href="terms.html">Terms</a><a href="privacy.html">Privacy</a><a href="licenses.html">Licences</a><a href="trademarks.html" title="Not affiliated with Adobe or Anthropic">Trademarks</a>
  </nav>
</footer>"""

HEAD = """<meta name="theme-color" content="#f6f6f4">
<link rel="icon" href="logo.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css">"""


def page_url(name):
    return SITE + "/" if name == "index.html" else SITE + "/" + name


def seo(name):
    title, desc = PAGES[name]
    full = title if name == "index.html" else "%s | %s" % (title, NAME)
    e = lambda s: html.escape(s, quote=True)
    tags = ['<title>%s</title>' % e(full), '<meta name="description" content="%s">' % e(desc)]
    if name == "404.html":
        tags.append('<meta name="robots" content="noindex">')
        return "\n".join(tags)
    url, img = page_url(name), SITE + "/og.png"
    tags += [
        '<link rel="canonical" href="%s">' % url,
        '<meta property="og:type" content="%s">' % ("website" if name == "index.html" else "article"),
        '<meta property="og:site_name" content="%s">' % e(NAME),
        '<meta property="og:title" content="%s">' % e(full),
        '<meta property="og:description" content="%s">' % e(desc),
        '<meta property="og:url" content="%s">' % url,
        '<meta property="og:image" content="%s">' % img,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="Claude working inside a dark After Effects window on a liquid-metal background">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<meta name="twitter:title" content="%s">' % e(full),
        '<meta name="twitter:description" content="%s">' % e(desc),
        '<meta name="twitter:image" content="%s">' % img,
    ]
    ld = None
    if name == "index.html":
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "WebSite", "name": NAME, "url": SITE + "/"},
            {"@type": "SoftwareApplication", "name": NAME, "url": SITE + "/", "image": img,
             "description": desc, "applicationCategory": "MultimediaApplication", "applicationSubCategory": "Motion graphics automation",
             "operatingSystem": "macOS, Windows", "isAccessibleForFree": True,
             "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
             "license": "https://www.apache.org/licenses/LICENSE-2.0", "softwareRequirements": "Adobe After Effects 2024 or newer, Node.js 18+",
             "sameAs": [REPO], "author": AUTHOR},
        ]}
    elif name == "docs.html":
        ld = {"@context": "https://schema.org", "@type": "TechArticle", "headline": title, "description": desc,
              "url": url, "image": img, "dateModified": TODAY, "author": AUTHOR}
    if ld:
        tags.append('<script type="application/ld+json">%s</script>' % json.dumps(ld, ensure_ascii=False))
    return "\n".join(tags)


# ---------- minimal Markdown (the subset GUIDE.md and legal/*.md use) ----------
def slug(text):
    s = re.sub(r"<[^>]+>", "", text).lower()
    s = re.sub(r"[^\w\s-]", "", s)
    return re.sub(r"\s+", "-", s.strip())


def inline(text):
    parts = re.split(r"(`[^`]+`)", text)
    out = []
    for p in parts:
        if p.startswith("`") and p.endswith("`") and len(p) > 1:
            out.append("<code>" + html.escape(p[1:-1]) + "</code>")
            continue
        p = html.escape(p, quote=False)
        p = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", p)
        p = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"<em>\1</em>", p)

        def link(m):
            label, url = m.group(1), m.group(2)
            if not url.startswith("http") and (url.endswith(".md") or ".md#" in url):  # repo files -> GitHub
                url = REPO + "/blob/main/" + url
            ext = url.startswith("http")
            return '<a href="%s"%s>%s</a>' % (html.escape(url, quote=True), ' rel="noopener"' if ext else "", label)
        p = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", link, p)
        out.append(p)
    return "".join(out)


def convert(md):
    lines = md.split("\n")
    out, toc, i = [], [], 0
    while i < len(lines):
        ln = lines[i]
        if ln.startswith("```"):
            buf, i = [], i + 1
            while i < len(lines) and not lines[i].startswith("```"):
                buf.append(lines[i]); i += 1
            out.append("<pre><code>" + html.escape("\n".join(buf)) + "</code></pre>"); i += 1; continue
        m = re.match(r"^(#{1,3}) (.+)$", ln)
        if m:
            lvl, text = len(m.group(1)), m.group(2)
            hid = slug(text)
            if lvl == 2: toc.append((hid, re.sub(r"^\d+\.\s*", "", text)))
            out.append('<h%d id="%s">%s</h%d>' % (lvl, hid, inline(text), lvl)); i += 1; continue
        if ln.strip() == "---":
            out.append("<hr>"); i += 1; continue
        if ln.startswith("|"):
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                rows.append([c.strip() for c in lines[i].strip().strip("|").split("|")]); i += 1
            head, body = rows[0], [r for r in rows[1:] if not re.match(r"^:?-+:?$", r[0] or "-")]
            t = ['<div class="table-scroll"><table><thead><tr>'] + ['<th scope="col">%s</th>' % inline(c) for c in head] + ["</tr></thead><tbody>"]
            for r in body: t += ["<tr>"] + ["<td>%s</td>" % inline(c) for c in r] + ["</tr>"]
            out.append("".join(t) + "</tbody></table></div>"); continue
        if ln.startswith(">"):
            buf = []
            while i < len(lines) and lines[i].startswith(">"):
                buf.append(lines[i].lstrip("> ").rstrip()); i += 1
            out.append("<blockquote><p>" + inline(" ".join(buf)) + "</p></blockquote>"); continue
        lm = re.match(r"^(\s*)([-*]|\d+\.) (.+)$", ln)
        if lm:
            ordered = lm.group(2)[0].isdigit()
            items = []
            while i < len(lines):
                m2 = re.match(r"^(\s*)([-*]|\d+\.) (.+)$", lines[i])
                if m2 and len(m2.group(1)) == 0:
                    items.append([m2.group(3)]); i += 1
                elif lines[i].startswith("   ") and lines[i].strip() and items:
                    items[-1].append(lines[i].strip()); i += 1
                else:
                    break
            tag = "ol" if ordered else "ul"
            lis = []
            for it in items:
                first, rest = it[0], it[1:]
                sub = [r for r in rest if re.match(r"^([-*]) ", r)]
                cont = [r for r in rest if not re.match(r"^([-*]) ", r)]
                body = inline(" ".join([first] + cont))
                if sub: body += "<ul>" + "".join("<li>%s</li>" % inline(re.sub(r"^[-*] ", "", s)) for s in sub) + "</ul>"
                lis.append("<li>%s</li>" % body)
            out.append("<%s>%s</%s>" % (tag, "".join(lis), tag)); continue
        if not ln.strip():
            i += 1; continue
        buf = []
        while i < len(lines) and lines[i].strip() and not re.match(r"^(#|```|\||>|\s*([-*]|\d+\.) |---$)", lines[i]):
            buf.append(lines[i].strip()); i += 1
        out.append("<p>" + inline(" ".join(buf)) + "</p>")
    return "\n".join(out), toc


def fill(tpl, name, **parts):
    s = tpl.replace("{{SEO}}", seo(name)).replace("{{HEAD}}", HEAD).replace("{{NAV}}", NAV).replace("{{FOOTER}}", FOOTER)
    for k, v in parts.items():
        s = s.replace("{{%s}}" % k, v)
    assert "{{" not in s, "unfilled token in " + name
    return s


def read(p):
    return open(os.path.join(HERE, p), encoding="utf-8").read()


def write(name, text):
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(text)


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    for f in STATIC:
        if os.path.exists(os.path.join(HERE, f)):
            shutil.copy(os.path.join(HERE, f), OUT)
    write("index.html", fill(read("index.template.html"), "index.html"))
    body, toc = convert(read(os.path.join("..", "GUIDE.md")))
    body = re.sub(r"(<h1[^>]*>.*?</h1>\s*<p>.*?</p>\s*)<ol>.*?</ol>\s*<hr>", r"\1", body, count=1, flags=re.S)
    toc_html = "".join('<li><a href="#%s">%s</a></li>' % (h, html.escape(t)) for h, t in toc)
    write("docs.html", fill(read("docs.template.html"), "docs.html", TOC=toc_html, BODY=body))
    page = read("page.template.html")
    for n in LEGAL:
        b, _ = convert(read(os.path.join("legal", n + ".md")))
        write(n + ".html", fill(page, n + ".html", BODY=b))
    write("404.html", fill(page, "404.html", BODY='<h1>Page not found</h1><p>This page doesn\'t exist. Try the <a href="./">home page</a> or the <a href="docs.html">guide</a>.</p>'))
    urls = [n for n in PAGES if n != "404.html"]
    write("sitemap.xml", '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          "".join("  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n" % (page_url(n), TODAY) for n in urls) + "</urlset>\n")
    write("robots.txt", "User-agent: *\nAllow: /\n\nSitemap: %s/sitemap.xml\n" % SITE)
    print("built %d pages into %s for %s" % (len(PAGES), OUT, SITE))


if __name__ == "__main__":
    main()
