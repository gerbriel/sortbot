import type { Gym } from '../types'
import { gymImage } from '../lib/images'
import { money } from '../lib/format'
import Icon from './Icon'

interface GymCardProps {
  gym: Gym
  isFavorite: boolean
  onOpen: (id: string) => void
  onToggleFavorite: (id: string) => void
}

export default function GymCard({ gym, isFavorite, onOpen, onToggleFavorite }: GymCardProps) {
  return (
    <article className="gym-card" onClick={() => onOpen(gym.id)}>
      <div className="gym-card-media">
        <img src={gymImage(gym.imageSeeds[0])} alt={gym.title} loading="lazy" />
        <button
          className={`fav-btn ${isFavorite ? 'is-fav' : ''}`}
          aria-label={isFavorite ? 'Remove from saved' : 'Save gym'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavorite(gym.id)
          }}
        >
          <Icon name={isFavorite ? 'heart-filled' : 'heart'} size={18} />
        </button>
        <div className="gym-card-badges">
          {gym.superhost && (
            <span className="badge badge-super">
              <Icon name="shield" size={12} /> Superhost
            </span>
          )}
          {gym.instantBook && (
            <span className="badge badge-instant">
              <Icon name="bolt" size={12} /> Instant book
            </span>
          )}
        </div>
      </div>

      <div className="gym-card-body">
        <div className="gym-card-row">
          <span className="gym-card-loc">
            {gym.neighborhood}, {gym.city}
          </span>
          <span className="gym-card-rating">
            <Icon name="star" size={13} /> {gym.rating.toFixed(2)}
          </span>
        </div>
        <h3 className="gym-card-title">{gym.title}</h3>
        <p className="gym-card-type">{gym.gymType}</p>
        <p className="gym-card-price">
          <strong>{money(gym.pricePerHour)}</strong> / hour
        </p>
      </div>
    </article>
  )
}
