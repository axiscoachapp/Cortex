/** "Lactose (intolerância)" is an intolerance, and reads as one; everything else in the list is an allergy. */
export function allergyLabel(entry: string): string {
  const intolerance = entry.match(/^(.*?)\s*\(intoler[âa]ncia(?::\s*(.+))?\)\s*$/i);
  if (!intolerance) return `Alergia a ${entry}`;
  return `Intolerância a ${intolerance[1]}${intolerance[2] ? ` (${intolerance[2]})` : ''}`;
}
