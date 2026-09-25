import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "_site");
const ignoredDirectories = new Set([".git", ".github", "_site", "node_modules"]);
const staticExtensions = new Set([
  ".avif", ".gif", ".ico", ".jpeg", ".jpg", ".pdf", ".png", ".svg", ".webp"
]);
const styles = await fs.readFile(path.join(root, "styles.css"), "utf8");

async function findMarkdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findMarkdownFiles(entryPath));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

async function findStaticFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") || ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findStaticFiles(entryPath));
    } else if (entry.isFile() && staticExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(entryPath);
    }
  }

  return files;
}

function outputPathFor(relativePath) {
  const parsed = path.parse(relativePath);
  const outputName = parsed.name.toLowerCase() === "readme"
    ? "index.html"
    : `${parsed.name}.html`;

  return path.join(outputDirectory, parsed.dir, outputName);
}

function pageTitle(markdown, relativePath) {
  const heading = markdown.match(/^#\s+(.+)$/m);
  return heading?.[1].replace(/[*_`]/g, "").trim()
    ?? path.parse(relativePath).name.replaceAll("-", " ");
}

function rewriteMarkdownLink(href) {
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("#")) {
    return href;
  }

  const [file, fragment] = href.split("#", 2);
  if (!file.toLowerCase().endsWith(".md")) {
    return href;
  }

  const parsed = path.posix.parse(file.replaceAll("\\", "/"));
  const outputName = parsed.name.toLowerCase() === "readme"
    ? "index.html"
    : `${parsed.name}.html`;
  const rewritten = path.posix.join(parsed.dir, outputName);

  return fragment ? `${rewritten}#${fragment}` : rewritten;
}

function renderMarkdown(markdown) {
  const usedSlugs = new Map();
  const parser = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === "link") {
        token.href = rewriteMarkdownLink(token.href);
      }
    }
  });
  parser.use({
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        const baseSlug = slugify(text);
        const count = usedSlugs.get(baseSlug) ?? 0;
        usedSlugs.set(baseSlug, count + 1);
        const slug = count === 0 ? baseSlug : `${baseSlug}-${count}`;

        return `<h${depth} id="${slug}">${text}</h${depth}>\n`;
      }
    }
  });

  return parser.parse(markdown).replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/g,
    (_, kind) => `<blockquote class="alert alert-${kind.toLowerCase()}"><p><strong>${kind[0]}${kind.slice(1).toLowerCase()}</strong><br>`
  );
}

function slugify(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "section";
}

function template({ title, content, isHome, homeHref }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="${escapeHtml(title)}">
    <title>${escapeHtml(title)}</title>
    <style>${styles}</style>
  </head>
  <body>
    <main>
      ${isHome ? "" : `<nav><a href="${homeHref}">← Curated list</a></nav>`}
      <article>${content}</article>
    </main>
  </body>
</html>
`;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

await fs.rm(outputDirectory, { recursive: true, force: true });
await fs.mkdir(outputDirectory, { recursive: true });

const markdownFiles = await findMarkdownFiles(root);
for (const file of markdownFiles) {
  const relativePath = path.relative(root, file);
  const markdown = await fs.readFile(file, "utf8");
  const outputPath = outputPathFor(relativePath);
  const outputRelativePath = path.relative(outputDirectory, outputPath);
  const homeRelativePath = path.relative(path.dirname(outputRelativePath), "index.html");
  const isHome = relativePath.toLowerCase() === "readme.md";

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, template({
    title: pageTitle(markdown, relativePath),
    content: renderMarkdown(markdown),
    isHome,
    homeHref: homeRelativePath.replaceAll("\\", "/") || "./index.html"
  }));
}

const staticFiles = await findStaticFiles(root);
for (const file of staticFiles) {
  const destination = path.join(outputDirectory, path.relative(root, file));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(file, destination);
}

await fs.writeFile(path.join(outputDirectory, ".nojekyll"), "");
console.log(
  `Built ${markdownFiles.length} Markdown page(s) and copied ${staticFiles.length} static asset(s) ` +
  `to ${path.relative(root, outputDirectory)}.`
);
