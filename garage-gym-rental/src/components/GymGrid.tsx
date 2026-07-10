import type { Gym } from '../types'
import GymCard from './GymCard'

interface GymGridProps {
  gyms: Gym[]
  favorites: string[]
  emptyMessage?: string
  onOpen: (id: string) => void
  onToggleFavorite: (id: string) => void
}

export default function GymGrid({ gyms, favorites, emptyMessage, onOpen, onToggleFavorite }: GymGridProps) {
  if (gyms.length === 0) {
    return (
      <div className="empty-state">
        <p>{emptyMessage ?? 'No gyms match your filters yet.'}</p>
      </div>
    )
  }

  return (
    <div className="gym-grid">
      {gyms.map((gym) => (
        <GymCard
          key={gym.id}
          gym={gym}
          isFavorite={favorites.includes(gym.id)}
          onOpen={onOpen}
          onToggleFavorite={onToggleFavorite}
        />
      ))}
    </div>
  )
}
