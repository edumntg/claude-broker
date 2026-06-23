const NAME_RE = /^[a-zA-Z][a-zA-Z0-9]{0,63}$/;

export function normalizeName(input: string): string {
  if (!input || typeof input !== 'string') {
    throw new Error('name is required');
  }
  const trimmed = input.trim();
  if (!trimmed) throw new Error('name cannot be empty');

  const parts = trimmed
    .split(/[-_\s]+/)
    .filter((p) => p.length > 0);

  if (parts.length === 0) throw new Error(`invalid name: "${input}"`);

  const camel =
    parts[0].charAt(0).toLowerCase() +
    parts[0].slice(1) +
    parts
      .slice(1)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
      .join('');

  const cleaned = camel.replace(/[^a-zA-Z0-9]/g, '');

  if (!NAME_RE.test(cleaned)) {
    throw new Error(
      `invalid name after normalization: "${cleaned}". Must match ${NAME_RE}`,
    );
  }
  return cleaned;
}
