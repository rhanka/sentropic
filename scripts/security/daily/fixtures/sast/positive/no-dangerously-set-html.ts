export function widgetProps(html: string) {
  return { dangerouslySetInnerHTML: { __html: html } };
}
