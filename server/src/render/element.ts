/**
 * A tiny element tree for Satori, without React: `{ type, props: { style, children } }` is what
 * Satori reads from a React element. Keeping the template as plain data also lets the tests read
 * every text it will draw.
 */

export type Style = Record<string, string | number>;

export interface Element {
  type: string;
  props: { style?: Style; children?: Node[] } & Record<string, unknown>;
}

export type Node = Element | string;
type Child = Node | null | undefined | false;

export function h(
  type: string,
  props: ({ style?: Style } & Record<string, unknown>) | null,
  ...children: (Child | Child[])[]
): Element {
  const flat = children.flat().filter((child): child is Node => Boolean(child) || child === '');
  return { type, props: { ...(props ?? {}), children: flat } };
}

/** A flex box (Satori needs `display: flex` on every element with more than one child). */
export function box(style: Style, ...children: (Child | Child[])[]): Element {
  return h('div', { style: { display: 'flex', ...style } }, ...children);
}

/** A single run of text. */
export function text(style: Style, value: string): Element {
  return h('div', { style: { display: 'flex', ...style } }, value);
}

/** Every string the template draws, in order (tests: no «ganancia», no names, no doubts). */
export function collectText(node: Node): string[] {
  if (typeof node === 'string') return [node];
  return (node.props.children ?? []).flatMap(collectText);
}
