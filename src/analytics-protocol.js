export const MAX_RUN_MS = 7 * 24 * 60 * 60 * 1000;
export function revisionContent(level) {
  return JSON.stringify({ grid: level.grid, entries: level.entries.map(({ id, number, direction, row, column, characterId, answer, clues }) =>
    ({ id, number, direction, row, column, characterId, answer, clues })) });
}
export async function levelRevision(level) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(revisionContent(level)));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export function solutionCells(level) {
  return Object.fromEntries(level.entries.flatMap((entry) => Array.from(entry.answer, (letter, i) => [
    `${entry.row + (entry.direction === 'down' ? i : 0)},${entry.column + (entry.direction === 'across' ? i : 0)}`, letter,
  ])));
}
