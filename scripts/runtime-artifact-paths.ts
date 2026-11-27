const PATH_BOUNDARY = /[\/\\\s"'`),;:}\]]/;

export function containsEmbeddedPath(text: string, candidate: string): boolean {
  if (!candidate) return false;

  let offset = 0;
  while (offset <= text.length - candidate.length) {
    const index = text.indexOf(candidate, offset);
    if (index < 0) return false;
    const suffix = text[index + candidate.length];
    if (suffix === undefined || PATH_BOUNDARY.test(suffix)) return true;
    offset = index + candidate.length;
  }
  return false;
}
