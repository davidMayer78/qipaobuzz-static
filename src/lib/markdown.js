import { site } from "./site.js";
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { marked } from 'marked';

const CONTENT_DIR = path.resolve(process.cwd(), 'src/content');

marked.setOptions({ breaks: true, gfm: true });

function embedFor(match) {
  let m;
  if ((m = match.match(/^\{\{youtube:([a-zA-Z0-9_-]+)(\?[^}]*)?\}\}$/))) {
    const src = `https://www.youtube.com/embed/${m[1]}${m[2] || ''}`;
    return `<div class="video-container"><iframe width="560" height="315" src="${src}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  if ((m = match.match(/^\{\{tiktok:([0-9]+)\}\}$/))) {
    return `<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@user/video/${m[1]}" data-video-id="${m[1]}" style="max-width:605px;min-width:325px;"><section></section></blockquote><script async src="https://www.tiktok.com/embed.js"></script>`;
  }
  if ((m = match.match(/^\{\{twitter:([0-9]+)\}\}$/))) {
    return `<blockquote class="twitter-tweet"><a href="https://twitter.com/x/status/${m[1]}"></a></blockquote><script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`;
  }
  if (match === '{{facebook}}') {
    return `<div class="fb-post" data-href=""></div><div id="fb-root"></div><script async defer crossorigin="anonymous" src="https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v18.0"></script>`;
  }
  if ((m = match.match(/^\{\{iframe:([^}]+)\}\}$/))) {
    return `<iframe src="${m[1]}" frameborder="0" allowfullscreen style="max-width:100%;height:auto;"></iframe>`;
  }
  return match;
}

const EMBED_RE = /\{\{(?:youtube:[a-zA-Z0-9_-]+(?:\?[^}]*)?|tiktok:[0-9]+|twitter:[0-9]+|facebook|iframe:[^}]+)\}\}/g;

function protectEmbeds(md) {
  const tokens = [];
  const transformed = md.replace(EMBED_RE, (match) => {
    const placeholder = `\n\n<!--EMBED_${tokens.length}-->\n\n`;
    tokens.push(embedFor(match));
    return placeholder;
  });
  return { transformed, tokens };
}

function restoreEmbeds(html, tokens) {
  return html.replace(/<!--EMBED_(\d+)-->/g, (_m, i) => tokens[Number(i)] || '');
}

function decodeTitle(data) {
  if (data.titleBase64) {
    return Buffer.from(data.titleBase64, 'base64').toString('utf-8');
  }
  return data.title || 'Untitled';
}

export function getExcerpt(content, maxLength = 160) {
  let text = content
    .replace(/\{\{(youtube|tiktok|twitter|facebook|iframe):[^}]*\}\}/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[.*?\]\(.*?\)/g, '')
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\n+/g, ' ')
    .trim();
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  if (text.length > maxLength) text = text.substring(0, maxLength - 3) + '...';
  return text || '';
}

function loadMarkdownDir(dir) {
  const fullPath = path.join(CONTENT_DIR, dir);
  if (!fs.existsSync(fullPath)) return [];
  return fs
    .readdirSync(fullPath)
    .filter((f) => f.endsWith('.md'))
    .map((file) => {
      const raw = fs.readFileSync(path.join(fullPath, file), 'utf-8');
      const { data, content } = matter(raw);
      return {
        slug: file.replace(/\.md$/, ''),
        title: decodeTitle(data),
        date: data.date ? new Date(data.date).toISOString() : new Date().toISOString(),
        tags: data.tags || [],
        published: data.published !== false,
        body: content,
        rawExcerpt: data.excerpt || getExcerpt(content, 200),
        frontmatter: data,
      };
    });
}

let _posts = null;
export function getAllPosts() {
  if (_posts) return _posts;
  _posts = loadMarkdownDir('posts')
    .filter((p) => p.published)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  return _posts;
}

export function renderMarkdown(body) {
  const { transformed, tokens } = protectEmbeds(body);
  const html = marked.parse(transformed);
  return restoreEmbeds(html, tokens);
}

export function getRelatedPosts(currentPost, allPosts, limit = 4) {
  if (!currentPost.tags || currentPost.tags.length === 0) {
    return allPosts.filter((p) => p.slug !== currentPost.slug).slice(0, limit);
  }
  const scored = allPosts
    .filter((p) => p.slug !== currentPost.slug)
    .map((post) => ({
      post,
      score: post.tags.filter((t) => currentPost.tags.includes(t)).length,
    }))
    .filter((i) => i.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((i) => i.post);
  if (scored.length < limit) {
    const remaining = allPosts
      .filter((p) => p.slug !== currentPost.slug && !scored.find((s) => s.slug === p.slug))
      .slice(0, limit - scored.length);
    scored.push(...remaining);
  }
  return scored.slice(0, limit);
}

export function extractFirstImage(html) {
  const m = html.match(/<img[^>]+src="(\/images\/[^"]+)"/);
  return m ? m[1] : null;
}

export function getPage(slug) {
  const filePath = path.join(CONTENT_DIR, 'pages', `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { data, content } = matter(raw);
  return {
    slug,
    title: decodeTitle(data),
    body: content,
  };
}

let _visibleTags = null;
export function getVisibleTags() {
  if (_visibleTags) return _visibleTags;
  const min = (typeof site !== 'undefined' && site.minTagCount) || 1;
  const counts = new Map();
  for (const p of getAllPosts()) {
    for (const t of p.tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  _visibleTags = new Set([...counts.entries()].filter(([, c]) => c >= min).map(([t]) => t));
  return _visibleTags;
}
