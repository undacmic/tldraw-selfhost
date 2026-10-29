export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error ?? 'The request failed')
  return result as T
}

export function invitationUrl(token: string): string {
  // Fragment secrets are not sent to the server in request URLs or Referer headers.
  return `${window.location.origin}/#invite=${encodeURIComponent(token)}`
}
