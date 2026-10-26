// Adapts the typedoc-plugin-markdown output to the docs/navigation/api folder of rnmapbox/maps-docs.
import fs from 'node:fs';
import path from 'node:path';
import { ReflectionKind, RendererEvent } from 'typedoc';
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';

const EDIT_URL = 'https://github.com/rnmapbox/navigation/blob/main/';
const PACKAGE =
  '@rnmapbox/navigation, turn-by-turn navigation for React Native';

/** @param {import('typedoc-plugin-markdown').MarkdownApplication} app */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    const model = page.model;
    const frontmatter = [];
    if (model.kind === ReflectionKind.Project) {
      frontmatter.push('slug: /navigation/api', 'sidebar_label: Overview');
      frontmatter.push(
        `title: ${yamlString('@rnmapbox/navigation API reference')}`
      );
      frontmatter.push(
        `description: ${yamlString(`API reference for ${PACKAGE}.`)}`
      );
    } else {
      frontmatter.push(`sidebar_label: ${model.name}`);
      frontmatter.push(`sidebar_position: ${sidebarPosition(model)}`);
      frontmatter.push(`description: ${yamlString(description(model))}`);
    }
    const source = model.sources?.[0]?.fileName;
    frontmatter.push(`custom_edit_url: ${source ? EDIT_URL + source : null}`);
    page.contents = [
      '---',
      ...frontmatter,
      '---',
      '',
      `{/* Generated from rnmapbox/navigation/${source ?? 'src'} by \`yarn docs\`. Don't edit. */}`,
      '',
      page.contents,
    ].join('\n');
  });

  app.renderer.on(RendererEvent.END, (event) => {
    const project = event.project;
    writeCategory(event.outputDirectory, {
      label: 'API reference',
      collapsed: false,
      link: { type: 'doc', id: 'navigation/api/index' },
    });
    project.groups?.forEach((group, index) => {
      const dir = path.join(event.outputDirectory, group.title);
      if (fs.existsSync(dir)) {
        writeCategory(dir, { label: group.title, position: index + 1 });
      }
    });
  });
}

// Docusaurus otherwise takes the first paragraph, which is the generated-file comment.
function description(model) {
  const comment = model.comment ?? model.signatures?.[0]?.comment;
  let summary = (comment?.summary ?? [])
    .map((part) =>
      part.kind === 'inline-tag' ? part.text.split('|').pop() : part.text
    )
    .join('')
    .split(/\n\s*\n/)[0]
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (summary.length > 160) {
    summary = summary.match(/^.+?[.!?](?=\s)/)?.[0] ?? summary;
  }
  const reference = `${model.name} API reference for ${PACKAGE}.`;
  if (!summary) {
    return reference;
  }
  return summary.length + reference.length < 160
    ? `${summary} ${reference}`
    : summary;
}

function yamlString(value) {
  return JSON.stringify(value);
}

function sidebarPosition(model) {
  const group = model.parent?.groups?.find((g) => g.children.includes(model));
  return (group?.children.indexOf(model) ?? 0) + 1;
}

function writeCategory(dir, category) {
  fs.writeFileSync(
    path.join(dir, '_category_.json'),
    JSON.stringify(category, null, 2) + '\n'
  );
}
