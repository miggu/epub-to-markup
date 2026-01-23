# EPUB to Markup CLI

Minimal Node.js command-line tool that converts an EPUB into a single Markdown-like document. No npm dependencies; it shells out to the system `unzip` command to unpack the EPUB. It doesn't even need any npm installation, it's using require to run as a plain CommonJs file without package.json.

## Usage

```bash
node epub2markup.js path/to/book.epub [output-file]
```

- When `output-file` is omitted, the generated markup is printed to stdout.
- The script reads the EPUB spine to follow the book's reading order and converts each HTML content file into simple Markdown-ish text (headings, paragraphs, lists, emphasis, links, images).
- After counting HTML spine items, an interactive prompt lets you choose output mode: single combined file (default) or split into per-chapter files named with an index plus the chapter title (e.g., `01 Chapter Title.md`). Split output goes to a folder named after the provided output file, or (if omitted) the EPUB’s title from metadata; if no title is available and you’re in a TTY, you’ll be prompted to name the folder (otherwise it falls back to the EPUB filename). Non-interactive runs default to a single file.
- Chapter splitting now uses only top-level entries from the EPUB table of contents (nav) when available: it follows TOC links (including fragment anchors within shared HTML files) to carve chapters, keeping subchapters inside their parent chapter instead of splitting them out.
- In split mode, you can optionally copy referenced images into an `images/` subfolder and the converter will rewrite image links to point there. This keeps the markdown + images self-contained.
- I wouldn't recommend to include images in most cases, as these are simple decorations in a lot of epub files, and would generate an unnecessary folder, use this feature at your own discretion.

## Requirements and notes

- Node.js 18+ recommended.
- The system `unzip` command must be available on `PATH`.
- I made sure the converter is intentionally conservative: it skips non-HTML spine items and ignores styling. Complex layouts or embedded scripts/styles are stripped. HTML entity decoding is basic but covers common cases.
- A simple progress bar with memory usage is printed to stderr while converting; stdout remains reserved for the converted content.
- I have not tested it in files > 60MB

## Quick sanity check

Run without arguments to see the usage line:

```bash
node epub2markup.js
```

With an EPUB on disk, supply its path and (optionally) an output file:

```bash
node epub2markup.js ~/books/my-title.epub my-title.md
```
