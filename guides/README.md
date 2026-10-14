# Student guides (sources)

The PDFs students see live in `files/guides/` (served with the site).
These HTML files are their sources: edit one here, then re-print it to
PDF with Edge in headless mode and replace the PDF:

    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --no-pdf-header-footer --virtual-time-budget=8000 --print-to-pdf="files\guides\filing-a-bill.pdf" "guides\filing-a-bill.html"

(Any browser's "Print to PDF" on the HTML file gives the same result.)
This folder is not rendered or published: `_quarto.yml` renders only
`*.qmd` and the generated page folders.
