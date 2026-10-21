// Adapts the typedoc-plugin-markdown output to the docs/navigation/api folder of rnmapbox/maps-docs.
import fs from 'node:fs';
import path from 'node:path';
import { ReflectionKind, RendererEvent } from 'typedoc';
import { MarkdownPageEvent } from 'typedoc-plugin-markdown';

const EDIT_URL = 'https://github.com/rnmapbox/navigation/blob/main/';

/** @param {import('typedoc-plugin-markdown').MarkdownApplication} app */
export function load(app) {
  app.renderer.on(MarkdownPageEvent.END, (page) => {
    const model = page.model;
    const frontmatter = [];
    if (model.kind === ReflectionKind.Project) {
      frontmatter.push('slug: /navigation/api', 'sidebar_label: Overview');
    } else {
      frontmatter.push(`sidebar_label: ${model.name}`);
      frontmatter.push(`sidebar_position: ${sidebarPosition(model)}`);
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
