export type BoardRole = 'owner' | 'editor' | 'viewer'

export interface BoardSummary {
  id: string
  name: string
  role: BoardRole
}
