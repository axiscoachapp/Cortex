/** What was prescribed, read defensively from the stored copy of the document. */
export function prescribedItems(rx: { medications?: unknown; issuance_snapshot?: { controlled?: { items?: unknown } } | null }): string[] {
  const label = (item: unknown) => {
    if (!item || typeof item !== 'object') return '';
    const { name, dosage, concentration } = item as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return '';
    const detail = typeof dosage === 'string' && dosage.trim() ? dosage : typeof concentration === 'string' ? concentration : '';
    return detail.trim() ? `${name.trim()} ${detail.trim()}` : name.trim();
  };
  const fromRow = Array.isArray(rx.medications) ? rx.medications.map(label).filter(Boolean) : [];
  if (fromRow.length) return fromRow;
  const controlled = rx.issuance_snapshot?.controlled?.items;
  return Array.isArray(controlled) ? controlled.map(label).filter(Boolean) : [];
}
