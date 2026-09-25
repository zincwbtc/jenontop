export function allowedOrigin(origin: string | null, configured?: string) {
  return !!origin && (configured || '').split(',').map(value => value.trim()).filter(Boolean).includes(origin);
}
