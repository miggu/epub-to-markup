# EPUB to Markup CLI

Minimal Node.js command-line tool that converts an EPUB into a single Markdown-like document. No npm dependencies; it shells out to the system `unzip` command to unpack the EPUB. It doesn't even need any npm installation, it's using require to run as a plain CommonJs file without package.json.

## Usage

```bash
node epub2markup.js path/to/book.epub [output-file]
```

- When `output-file` is omitted, the generated markup is printed to stdout.
- The script reads the EPUB spine to follow the book's reading order and converts each HTML content file into simple Markdown-ish text (headings, paragraphs, lists, emphasis, links, images).

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
