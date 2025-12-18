#!/usr/bin/env node
/**
 * Minimal EPUB to Markdown-like converter.
 *
 * Usage: node epub2markup.js path/to/book.epub [output-file]
 *
 * Converts the EPUB spine (in reading order) into a single Markdown-ish string,
 * preserving basic structure (headings, paragraphs, lists, emphasis). Depends
 * on the system `unzip` command; no npm installs required.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const [, , inputArg, outputArg] = process.argv;

function usage() {
  console.log('Usage: node epub2markup.js path/to/book.epub [output-file]');
}

if (!inputArg) {
  usage();
  process.exit(1);
}

const inputPath = path.resolve(process.cwd(), inputArg);
const outputPath = outputArg ? path.resolve(process.cwd(), outputArg) : null;

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

let tempDir;
const cleanup = () => {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};
process.on('exit', cleanup);
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

function ensureUnzipAvailable() {
  try {
    execFileSync('unzip', ['-v'], { stdio: 'ignore' });
  } catch (err) {
    throw new Error('The "unzip" command is required but was not found on PATH.');
  }
}

function unzipEpub(epubPath, destination) {
  execFileSync('unzip', ['-qq', epubPath, '-d', destination]);
}

function readText(filePath, label) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new Error(`Could not read ${label || filePath}: ${err.message}`);
  }
}

function extractRootfile(containerXml) {
  const match = containerXml.match(/full-path="([^"]+)"/i);
  return match ? match[1] : null;
}

function attrFromTag(tag, name) {
  const regex = new RegExp(`${name}="([^"]+)"`, 'i');
  const match = tag.match(regex);
  return match ? match[1] : null;
}

function parseManifest(opfText) {
  const manifest = {};
  const itemRegex = /<item\b[^>]*?>/gi;

  const tags = opfText.match(itemRegex) || [];
  for (const tag of tags) {
    const id = attrFromTag(tag, 'id');
    const href = attrFromTag(tag, 'href');
    const mediaType = attrFromTag(tag, 'media-type');
    if (id && href) {
      manifest[id] = { href, mediaType };
    }
  }
  return manifest;
}

function parseSpine(opfText) {
  const spine = [];
  const spineRegex = /<itemref\b[^>]*?>/gi;
  const tags = opfText.match(spineRegex) || [];
  for (const tag of tags) {
    const idref = attrFromTag(tag, 'idref');
    if (idref) spine.push(idref);
  }
  return spine;
}

function decodeEntities(text) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };

  return text.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (full, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : full;
    }
    if (entity.startsWith('#')) {
      const code = parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : full;
    }
    return Object.prototype.hasOwnProperty.call(named, entity) ? named[entity] : full;
  });
}

function convertHtmlToMarkup(html) {
  let text = html;

  // Drop scripts/styles.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Handle media and anchors before stripping tags.
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attrFromTag(tag, 'alt') || '';
    const src = attrFromTag(tag, 'src') || '';
    if (!src) return '';
    return `![${alt}](${src})`;
  });

  text = text.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (match, body) => {
    const href = attrFromTag(match, 'href');
    const label = body.trim() || href || '';
    return href ? `[${label}](${href})` : label;
  });

  // Structural tags to Markdown-ish equivalents.
  const heading = (level, body) => `${'#'.repeat(level)} ${body.trim()}\n\n`;
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, body) => heading(1, body));
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, body) => heading(2, body));
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, body) => heading(3, body));
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, body) => heading(4, body));
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, body) => heading(5, body));
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, body) => heading(6, body));

  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, body) => `> ${body.trim()}\n\n`);

  text = text.replace(/<br\s*\/?>/gi, '\n');

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `- ${body.trim()}\n`);
  text = text.replace(/<\/(ul|ol)>/gi, '\n');

  text = text.replace(/<\/p>/gi, '\n\n');
  text = text.replace(/<p[^>]*>/gi, '');

  // Inline emphasis/strong/code.
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, body) => `*${body.trim()}*`);
  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, body) => `**${body.trim()}**`);
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, body) => `\`${body.trim()}\``);

  // Remove remaining tags.
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  // Normalize whitespace.
  text = text.split('\n').map((line) => line.trimEnd()).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');

  return text.trim();
}

function formatBytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function memorySnapshot() {
  const { rss, heapUsed } = process.memoryUsage();
  return `rss ${formatBytes(rss)}, heap ${formatBytes(heapUsed)}`;
}

function main() {
  ensureUnzipAvailable();

  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epub2markup-'));
  try {
    unzipEpub(inputPath, tempDir);
  } catch (err) {
    console.error(`Failed to unzip EPUB: ${err.message}`);
    process.exit(1);
  }

  const containerPath = path.join(tempDir, 'META-INF', 'container.xml');
  if (!fs.existsSync(containerPath)) {
    console.error('Invalid EPUB: missing META-INF/container.xml');
    process.exit(1);
  }

  const containerXml = readText(containerPath, 'META-INF/container.xml');
  const rootfileRelative = extractRootfile(containerXml);
  if (!rootfileRelative) {
    console.error('Could not determine OPF package path from container.xml');
    process.exit(1);
  }

  const opfPath = path.join(tempDir, rootfileRelative);
  const opfDir = path.dirname(opfPath);
  const opfText = readText(opfPath, `${rootfileRelative}`);

  const manifest = parseManifest(opfText);
  const spine = parseSpine(opfText);

  if (!spine.length) {
    console.error('OPF spine is empty or missing; nothing to convert.');
    process.exit(1);
  }

  const sections = [];
  const total = spine.length;
  let processed = 0;

  const reportProgress = () => {
    const percent = Math.floor((processed / total) * 100);
    const barWidth = 20;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = `[${'#'.repeat(filled)}${'.'.repeat(barWidth - filled)}]`;
    process.stderr.write(`\r${bar} ${processed}/${total} ${percent}% | ${memorySnapshot()}`);
  };

  for (const idref of spine) {
    const item = manifest[idref];
    if (!item) {
      console.error(`Warning: spine item "${idref}" not found in manifest; skipping.`);
      processed += 1;
      reportProgress();
      continue;
    }
    const isHtml = item.mediaType && item.mediaType.toLowerCase().includes('html');
    if (!isHtml) {
      processed += 1;
      reportProgress();
      continue;
    }

    const htmlPath = path.normalize(path.join(opfDir, item.href));
    if (!fs.existsSync(htmlPath)) {
      console.error(`Warning: content file missing: ${item.href}`);
      processed += 1;
      reportProgress();
      continue;
    }

    const html = readText(htmlPath, item.href);
    const markup = convertHtmlToMarkup(html);
    if (markup) {
      sections.push(markup);
    }

    processed += 1;
    reportProgress();
  }
  process.stderr.write('\n');

  const result = sections.join('\n\n');
  if (outputPath) {
    fs.writeFileSync(outputPath, result + '\n', 'utf8');
    console.log(`Wrote markup to ${outputPath}`);
  } else {
    process.stdout.write(result);
  }
}

main();
