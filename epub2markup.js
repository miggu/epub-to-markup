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
const readline = require('node:readline');

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
    const properties = attrFromTag(tag, 'properties');
    if (id && href) {
      manifest[id] = { href, mediaType, properties };
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

function convertHtmlToMarkup(html, options = {}) {
  const { rewriteImageSrc, baseDir } = options;
  let text = html;

  // Drop scripts/styles.
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // Handle media and anchors before stripping tags.
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = attrFromTag(tag, 'alt') || '';
    const src = attrFromTag(tag, 'src') || '';
    if (!src) return '';
    const finalSrc = rewriteImageSrc ? rewriteImageSrc(src, { baseDir }) : src;
    return `![${alt}](${finalSrc})`;
  });

  text = text.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (match, body) => {
    const href = attrFromTag(match, 'href') || '';
    const label = body.trim() || href || '';
    const isTocLink = /#toc\b/i.test(href) || /toc\.x?html/i.test(href) || /nav\.x?html/i.test(href);
    const isInternalDoc = /\.(xhtml?|htm)(#|$)/i.test(href) && !/^https?:/i.test(href);
    if (!href || isTocLink || isInternalDoc) return label;
    return `[${label}](${href})`;
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

  // Collapse runaway emphasis markers (e.g., literal "**" in source).
  text = text.replace(/\*{4,}/g, '**');
  text = text.replace(/(#{1,6}\s*)\[(\*\*[^*\n]+?\*\*)(?![^\n]*\])/g, '$1$2');

  // Trim spaces just inside emphasis markers: "* text *" -> "*text*".
  text = text.replace(/\*\*([\s\S]*?)\*\*/g, (_, body) => `**${body.trim()}**`);
  text = text.replace(/\*([\s\S]*?)\*/g, (_, body) => `*${body.trim()}*`);

  // Remove remaining tags.
  text = text.replace(/<[^>]+>/g, '');
  text = decodeEntities(text);

  // Drop lingering toc/nav markdown links.
  text = text.replace(/\[([^\]]+)\]\([^)]+#toc[^)]*\)/gi, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+toc\.x?html[^)]*\)/gi, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+nav\.x?html[^)]*\)/gi, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\.xhtml[^)]*\)/gi, '$1');
  text = text.replace(/\[([^\]]+)\]\([^)]+\.html[^)]*\)/gi, '$1');

  // Ensure space after closing emphasis/strong/code when followed by alphanumerics with no space.
  text = text.replace(/(\*{1,2}[^*]+?\*{1,2})(?=[A-Za-z0-9])/g, '$1 ');
  text = text.replace(/(`[^`]+`)(?=[A-Za-z0-9])/g, '$1 ');

  // Normalize spacing inside emphasis markers (catch lingering spaces after the opening or before the closing).
  text = text.replace(/(\*{1,2})\s*([^\*\n][^*]*?)\s*(\*{1,2})/g, '$1$2$3');

  // Strip leading indentation/tabs per line to avoid Markdown code blocks and collapse excess spaces.
  text = text.replace(/\t+/g, ' ');
  text = text.replace(/^[ \t]+/gm, '');
  text = text.replace(/ {2,}/g, ' ');

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

function slugifyTitle(title, index) {
  const prefix = String(index).padStart(2, '0');
  const cleaned = (title || '').trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ');
  const truncated = cleaned.length ? cleaned.slice(0, 80) : `Chapter ${prefix}`;
  return `${prefix} ${truncated}`.trim();
}

function safeBaseNameFromTitle(title) {
  if (!title) return null;
  const cleaned = title.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').slice(0, 120);
  return cleaned || null;
}

function findNavItem(manifest) {
  const entries = Object.values(manifest);
  for (const item of entries) {
    if (item.properties && item.properties.split(/\s+/).includes('nav')) {
      return item;
    }
  }
  return null;
}

function stripTags(text) {
  return decodeEntities(text.replace(/<[^>]+>/g, '')).trim();
}

function parseNavHtml(navHtml) {
  // Try to scope to the main TOC nav if present.
  const navMatch = navHtml.match(/<nav[^>]*?(epub:type="toc"[^>]*|role="doc-toc"[^>]*)>[\s\S]*?<\/nav>/i);
  const tocHtml = navMatch ? navMatch[0] : navHtml;
  const links = [];
  const tokenRegex = /<\/?ol[^>]*>|<\/?li[^>]*>|<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let depth = 0;
  let match;
  while ((match = tokenRegex.exec(tocHtml)) !== null) {
    const [token, href, labelRaw] = match;
    if (/^<ol/i.test(token)) {
      depth += 1;
    } else if (/^<\/ol/i.test(token)) {
      depth = Math.max(0, depth - 1);
    } else if (/^<a/i.test(token)) {
      const label = stripTags(labelRaw);
      if (href) {
        links.push({ href, label: label || href, depth });
      }
    }
  }
  return links;
}

function resolveHref(baseDir, href) {
  const [filePart, fragment] = href.split('#');
  const filePath = path.normalize(path.join(baseDir, filePart || ''));
  return { filePath, fragment: fragment || null };
}

function findAnchorPosition(html, anchor) {
  if (!anchor) return 0;
  const escaped = anchor.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const patterns = [
    new RegExp(`id=["']${escaped}["']`, 'i'),
    new RegExp(`name=["']${escaped}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      const tagStart = html.lastIndexOf('<', match.index);
      const start = tagStart !== -1 ? tagStart : match.index;
      // If this anchor sits inside a heading, back up to the heading start so we keep the full tag.
      const searchStart = Math.max(0, start - 500);
      const segment = html.slice(searchStart, start);
      const headingRegex = /<h[1-6][^>]*>/gi;
      let headingStart = null;
      let hm;
      while ((hm = headingRegex.exec(segment)) !== null) {
        headingStart = hm.index + searchStart;
      }
      return headingStart !== null ? headingStart : start;
    }
  }
  return null;
}

function extractTitle(opfText) {
  const match = opfText.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  if (!match) return null;
  return stripTags(match[1]);
}

function promptSplit(totalChapters) {
  if (!process.stdin.isTTY) return { mode: 'single', includeImages: false };

  console.log('\n📖 Select output mode:');
  console.log('1) Single file (default)');
  console.log(`2) Split into chapters (${totalChapters} parts)`);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question('Choice (1/2): ', (answer) => {
      const normalized = answer.trim();
      if (normalized === '2') {
        rl.question('Include images in output folder? (y/n): ', (imgAnswer) => {
          rl.close();
          const includeImages = /^y(es)?$/i.test(imgAnswer.trim());
          resolve({ mode: 'split', includeImages });
        });
      } else {
        rl.close();
        resolve({ mode: 'single', includeImages: false });
      }
    });
  });
}

function promptFolderName(defaultName) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve(defaultName);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const prompt = `Folder name for split output [${defaultName}]: `;
    rl.question(prompt, (answer) => {
      rl.close();
      const name = answer.trim();
      resolve(name || defaultName);
    });
  });
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
  const bookTitle = extractTitle(opfText);

  const manifest = parseManifest(opfText);
  const spine = parseSpine(opfText);

  if (!spine.length) {
    console.error('OPF spine is empty or missing; nothing to convert.');
    process.exit(1);
  }

  const htmlItems = [];
  for (const idref of spine) {
    const item = manifest[idref];
    if (!item) {
      console.error(`Warning: spine item "${idref}" not found in manifest; skipping.`);
      continue;
    }
    const isHtml = item.mediaType && item.mediaType.toLowerCase().includes('html');
    if (!isHtml) continue;
    htmlItems.push({ idref, href: item.href, path: path.normalize(path.join(opfDir, item.href)), properties: item.properties || '' });
  }

  if (!htmlItems.length) {
    console.error('No HTML content found in the spine; nothing to convert.');
    process.exit(1);
  }

  let navEntries = [];
  const navItem = findNavItem(manifest);
  if (navItem) {
    const navPath = path.join(opfDir, navItem.href);
    if (fs.existsSync(navPath)) {
      const navHtml = readText(navPath, navItem.href);
      navEntries = parseNavHtml(navHtml).map((entry) => {
        const resolved = resolveHref(path.dirname(navPath), entry.href);
        return { ...entry, filePath: resolved.filePath, fragment: resolved.fragment };
      }).filter((entry) => entry.depth === 1);
    }
  }

  // Map nav entries to spine order; fall back to spine items if nav is missing.
  const chapters = [];
  if (navEntries.length) {
    const spineOrder = new Map(htmlItems.map((item, idx) => [path.normalize(item.path), idx]));
    const groupedByFile = navEntries.reduce((acc, entry) => {
      const fileKey = path.normalize(entry.filePath);
      const spineIdx = spineOrder.has(fileKey) ? spineOrder.get(fileKey) : Number.MAX_SAFE_INTEGER;
      acc.push({ ...entry, spineIdx });
      return acc;
    }, []);
    groupedByFile.sort((a, b) => a.spineIdx - b.spineIdx);
    const grouped = groupedByFile.reduce((map, entry) => {
      const key = path.normalize(entry.filePath);
      if (!map[key]) map[key] = [];
      map[key].push(entry);
      return map;
    }, {});

    for (const [filePath, entries] of Object.entries(grouped)) {
      if (!fs.existsSync(filePath)) continue;
      const html = readText(filePath, path.relative(opfDir, filePath));
      const positions = entries.map((entry, idx) => {
        const pos = findAnchorPosition(html, entry.fragment);
        return { ...entry, pos: pos === null ? null : pos, idx };
      });

      for (let i = 0; i < positions.length; i += 1) {
        const current = positions[i];
        const next = positions.slice(i + 1).find((p) => p.pos !== null);
        const start = current.pos !== null ? current.pos : (i === 0 ? 0 : positions[i - 1].pos || 0);
        const end = next && next.pos !== null ? next.pos : html.length;
        const slice = html.slice(start, end);
        chapters.push({
          label: current.label,
          content: slice,
          order: ((current.spineIdx ?? 0) * 10000) + current.idx,
          filePath,
        });
      }
    }
  } else {
    for (const item of htmlItems) {
      if (!fs.existsSync(item.path)) continue;
      const html = readText(item.path, item.href);
      chapters.push({
        label: path.basename(item.href),
        content: html,
        order: spine.indexOf(item.idref),
        filePath: item.path,
      });
    }
  }

  if (!chapters.length) {
    console.error('No chapters could be derived from TOC or spine.');
    process.exit(1);
  }

  chapters.sort((a, b) => a.order - b.order);

  const total = chapters.length;
  let processed = 0;
  const sections = [];
  let outputMode = 'single';
  let includeImages = false;

  const reportProgress = () => {
    const percent = Math.floor((processed / total) * 100);
    const barWidth = 20;
    const filled = Math.round((percent / 100) * barWidth);
    const bar = `[${'#'.repeat(filled)}${'.'.repeat(barWidth - filled)}]`;
    process.stderr.write(`\r${bar} ${processed}/${total} ${percent}% | ${memorySnapshot()}`);
  };

  (async () => {
    const choice = await promptSplit(total);
    outputMode = choice.mode;
    includeImages = choice.includeImages;

    let chapterDir = null;
    let imagesDir = null;
    const copyQueue = new Map(); // dest -> src
    if (outputMode === 'split') {
      let baseName = null;
      if (outputPath) {
        baseName = path.basename(outputPath, path.extname(outputPath));
      } else if (safeBaseNameFromTitle(bookTitle)) {
        baseName = safeBaseNameFromTitle(bookTitle);
      } else if (process.stdin.isTTY) {
        const suggested = path.basename(inputPath, path.extname(inputPath));
        baseName = await promptFolderName(suggested);
      } else {
        baseName = path.basename(inputPath, path.extname(inputPath));
      }
      chapterDir = path.resolve(process.cwd(), baseName);
      if (!fs.existsSync(chapterDir)) {
        fs.mkdirSync(chapterDir, { recursive: true });
      }
      if (includeImages) {
        imagesDir = path.join(chapterDir, 'images');
      }
    }

    const rewriteImageSrc =
      includeImages && chapterDir
        ? (src, ctx) => {
            const baseDir = ctx.baseDir || opfDir;
            const absSrc = path.normalize(path.join(baseDir, src));
            if (!absSrc.startsWith(tempDir)) return src;
            const relativeFromTemp = path.relative(tempDir, absSrc);
            if (relativeFromTemp.startsWith('..')) return src;
            const targetRel = path.join('images', relativeFromTemp);
            const targetAbs = path.join(chapterDir, targetRel);
            if (!copyQueue.has(targetAbs)) {
              copyQueue.set(targetAbs, absSrc);
            }
            return targetRel.split(path.sep).join('/');
          }
        : null;

    for (const chapter of chapters) {
      const markup = convertHtmlToMarkup(chapter.content, {
        rewriteImageSrc,
        baseDir: path.dirname(chapter.filePath),
      });
      if (markup) {
        if (outputMode === 'split') {
          const index = processed + 1;
          const filenameBase = slugifyTitle(chapter.label, index);
          const filename = `${filenameBase}.md`;
          const target = path.join(chapterDir, filename);
          const title = chapter.label || `Chapter ${index}`;
          const withTitle = `# ${title}\n\n${markup}`;
          fs.writeFileSync(target, withTitle + '\n', 'utf8');
        } else {
          const title = chapter.label ? `# ${chapter.label}\n\n` : '';
          sections.push(`${title}${markup}`);
        }
      }

      processed += 1;
      reportProgress();
    }
    process.stderr.write('\n');

    if (outputMode === 'split') {
      if (includeImages && copyQueue.size) {
        for (const [dest, src] of copyQueue.entries()) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          try {
            fs.copyFileSync(src, dest);
          } catch (err) {
            console.error(`Warning: failed to copy image ${src}: ${err.message}`);
          }
        }
        if (!fs.existsSync(imagesDir)) {
          // Ensure the root images directory exists if nothing was copied deeper.
          fs.mkdirSync(imagesDir, { recursive: true });
        }
      }
      console.log(`Wrote ${processed} files to ${chapterDir}`);
    } else {
      const result = sections.join('\n\n');
      if (outputPath) {
        fs.writeFileSync(outputPath, result + '\n', 'utf8');
        console.log(`Wrote markup to ${outputPath}`);
      } else {
        process.stdout.write(result);
      }
    }
  })().catch((err) => {
    console.error(`Unexpected error: ${err.message}`);
    process.exit(1);
  });
}

main();
