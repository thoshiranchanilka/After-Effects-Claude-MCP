"""Build site/docs.html from ../GUIDE.md (no dependencies). Run: python3 site/build.py
Handles the Markdown GUIDE.md uses: headings, paragraphs, lists, tables, fenced code, blockquotes, hr,
inline code / bold / italic / links."""
import html
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "..", "GUIDE.md")
OUT = os.path.join(HERE, "docs.html")
REPO = "https://github.com/thoshiranchanilka/After-Effects-Claude-MCP"


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
            if url.endswith(".md") or ".md#" in url:  # repo files -> GitHub
                url = REPO + "/blob/main/" + url
            return '<a href="%s">%s</a>' % (html.escape(url, quote=True), label)
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


def main():
    body, toc = convert(open(SRC, encoding="utf-8").read())
    # drop the GUIDE's own contents list (the sidebar replaces it)
    body = re.sub(r"(<h1[^>]*>.*?</h1>\s*<p>.*?</p>\s*)<ol>.*?</ol>\s*<hr>", r"\1", body, count=1, flags=re.S)
    toc_html = "".join('<li><a href="#%s">%s</a></li>' % (h, html.escape(t)) for h, t in toc)
    page = open(os.path.join(HERE, "docs.template.html"), encoding="utf-8").read()
    page = page.replace("{{TOC}}", toc_html).replace("{{BODY}}", body)
    open(OUT, "w", encoding="utf-8").write(page)
    print("wrote", OUT, "-", len(toc), "sections")


if __name__ == "__main__":
    main()
