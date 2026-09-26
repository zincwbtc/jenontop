export function allowedOrigin(origin: string | null, configured?: string) {
  return !!origin && (configured || '').split(',').map(value => value.trim()).filter(Boolean).includes(origin);
}

export function requestOrigin(request: Request) {
  // Same-origin browser GETs omit Origin; Fetch Metadata identifies that case. Older iPhones (iOS < 16.4)
  // send neither, so fall back to a same-origin Referer.
  const origin = request.headers.get('Origin');
  if (origin) return origin;
  const self = new URL(request.url).origin;
  if (request.headers.get('Sec-Fetch-Site') === 'same-origin') return self;
  try { return new URL(request.headers.get('Referer') || '').origin === self ? self : ''; } catch { return ''; }
}
