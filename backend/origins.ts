export function allowedOrigin(origin: string | null, configured?: string) {
  return !!origin && (configured || '').split(',').map(value => value.trim()).filter(Boolean).includes(origin);
}

export function requestOrigin(request: Request) {
  // Same-origin browser GETs omit Origin; Fetch Metadata identifies that case.
  return request.headers.get('Origin') || (request.headers.get('Sec-Fetch-Site') === 'same-origin' ? new URL(request.url).origin : '');
}
