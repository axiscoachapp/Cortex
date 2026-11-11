/** Brings a form field with a problem into view and puts the cursor in it, so the person
 * sees the message under it instead of a toast far from the field. */
export function focusField(id: string): boolean {
  const field = document.getElementById(id);
  if (!field) return false;
  field.scrollIntoView?.({ block: 'center' });
  field.focus({ preventScroll: true });
  return true;
}
