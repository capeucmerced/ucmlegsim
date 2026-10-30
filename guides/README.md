# Student guides (sources)

The PDFs students see live in `files/guides/` (served with the site).
These HTML files are their sources: edit one here, then re-print it to
PDF with Edge in headless mode and replace the PDF:

    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="files\guides\filing-a-bill.pdf" "guides\filing-a-bill.html"

(Any browser's "Print to PDF" on the HTML file gives the same result.)
Guides so far: filing-a-bill (senators), committee-assignments (leadership:
assignments + referrals), committee-agendas (chairs), recording-votes
(committee and floor secretaries). The Filing Cabinet (forms.qmd) links
each form's guide beside it via the drawer() guides argument; the votes
guide, which belongs to a sheet rather than a form, is linked from the
Votes page (votes.qmd) and from a Secretaries line in forms.qmd.

This folder is not rendered or published: `_quarto.yml` renders only
`*.qmd` and the generated page folders.
