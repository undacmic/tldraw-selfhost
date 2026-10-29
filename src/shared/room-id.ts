/** Shared browser/server policy. Room IDs are case-sensitive and are never normalized. */
export function isValidRoomId(roomId: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(roomId)
}
