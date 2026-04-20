import rss from '@astrojs/rss';
import { site } from '../lib/site.js';
import { getAllPosts, renderMarkdown, getExcerpt } from '../lib/markdown.js';

export function GET(context) {
  const posts = getAllPosts().slice(0, 20);
  return rss({
    title: site.name,
    description: site.description,
    site: context.site ?? site.url,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: new Date(post.date),
      description: getExcerpt(post.body, 300),
      link: `/${post.slug}/`,
    })),
  });
}
