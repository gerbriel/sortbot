import type { Booking } from '../types'
import { gymImage } from '../lib/images'
import { hourLabel, money, formatDate } from '../lib/format'
import Icon from './Icon'

interface TripsViewProps {
  bookings: Booking[]
  onOpenGym: (id: string) => void
  onCancel: (bookingId: string) => void
  onBrowse: () => void
}

export default function TripsView({ bookings, onOpenGym, onCancel, onBrowse }: TripsViewProps) {
  const sorted = [...bookings].sort((a, b) => b.createdAt - a.createdAt)

  return (
    <div className="trips-page">
      <h1 className="page-title">My bookings</h1>

      {sorted.length === 0 ? (
        <div className="empty-state empty-state--cta">
          <Icon name="calendar" size={40} />
          <p>You haven't booked a session yet.</p>
          <button className="btn btn-primary" onClick={onBrowse}>
            Find a garage gym
          </button>
        </div>
      ) : (
        <div className="trips-list">
          {sorted.map((b) => (
            <div key={b.id} className="trip-card">
              <button className="trip-media" onClick={() => onOpenGym(b.gymId)} aria-label={`Open ${b.gymTitle}`}>
                <img src={gymImage(b.gymImageSeed, 320, 220)} alt={b.gymTitle} />
              </button>
              <div className="trip-info">
                <h3 className="trip-title" onClick={() => onOpenGym(b.gymId)}>
                  {b.gymTitle}
                </h3>
                <p className="trip-loc">
                  <Icon name="pin" size={14} /> {b.city}, {b.state}
                </p>
                <div className="trip-meta">
                  <span>
                    <Icon name="calendar" size={14} /> {formatDate(b.date)}
                  </span>
                  <span>
                    <Icon name="clock" size={14} /> {hourLabel(b.startHour)} · {b.hours} {b.hours === 1 ? 'hr' : 'hrs'}
                  </span>
                  <span>
                    <Icon name="users" size={14} /> {b.lifters} {b.lifters === 1 ? 'lifter' : 'lifters'}
                  </span>
                </div>
              </div>
              <div className="trip-side">
                <span className="trip-total">{money(b.total)}</span>
                <button className="link-btn link-btn--danger" onClick={() => onCancel(b.id)}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
