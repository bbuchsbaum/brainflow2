import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
it('shipping entry points never transitively import design fixtures', () => {
  const root = resolve(__dirname, '..');
  const queue = ['module.ts', 'activate.ts'].map((name) => resolve(root, name));
  const seen = new Set<string>();
  while (queue.length) {
    const path = queue.pop()!; if (seen.has(path)) continue; seen.add(path);
    expect(path).not.toMatch(/__design__|__tests__|mockData|scenes|components\/shared\/session\.ts|components\/directions/);
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const follow = (specifier: string) => {
      const own = specifier.startsWith('@/modules/segmentation/') ? resolve(root, specifier.slice('@/modules/segmentation/'.length)) : specifier.startsWith('.') ? resolve(dirname(path), specifier) : null;
      if (!own) return;
      const target = [own, own + '.ts', own + '.tsx', resolve(own, 'index.ts'), resolve(own, 'index.tsx')].find((candidate) => existsSync(candidate) && /\.[jt]sx?$/.test(candidate));
      expect(target, `${path} imports an unresolved own module ${specifier}`).toBeDefined(); queue.push(target!);
    };
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) follow(node.moduleSpecifier.text);
      if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) follow(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) follow(node.arguments[0].text);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect([...seen].some((path) => path.endsWith('/SegmentViewport.tsx'))).toBe(true);
  expect([...seen].some((path) => path.endsWith('/SegmentationInspector.tsx'))).toBe(true);
});
