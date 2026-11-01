export function compile(body: string) {
  return new Function('return ' + body);
}
