import { useState } from 'react'
import type { Booking, Gym } from '../types'
import { gymImage, avatar, initialsOf } from '../lib/images'
import { hourLabel, shortDays } from '../lib/format'
import Icon from './Icon'
import BookingWidget from './BookingWidget'

interface GymDetailProps {
  gym: Gym
  isFavorite: boolean
  onBack: () => void
  onBook: (booking: Booking) => void
  onToggleFavorite: (id: string) => void
}

export default function GymDetail({ gym, isFavorite, onBack, onBook, onToggleFavorite }: GymDetailProps) {
  const [activeImg, setActiveImg] = useState(0)

  return (
    <div className="detail">
      <button className="back-link" onClick={onBack}>
        <Icon name="arrow-left" size={18} /> Back to results
      </button>

      <div className="detail-head">
        <h1 className="detail-title">{gym.title}</h1>
        <div className="detail-subhead">
          <span className="detail-rating">
            <Icon name="star" size={15} /> {gym.rating.toFixed(2)} · {gym.reviewCount} reviews
          </span>
          <span className="detail-dot">·</span>
          <span className="detail-loc">
            <Icon name="pin" size={15} /> {gym.neighborhood}, {gym.city}, {gym.state}
          </span>
          {gym.superhost && (
            <>
              <span className="detail-dot">·</span>
              <span className="detail-super">
                <Icon name="shield" size={15} /> Superhost
              </span>
            </>
          )}
          <button
            className={`detail-save ${isFavorite ? 'is-fav' : ''}`}
            onClick={() => onToggleFavorite(gym.id)}
          >
            <Icon name={isFavorite ? 'heart-filled' : 'heart'} size={16} /> {isFavorite ? 'Saved' : 'Save'}
          </button>
        </div>
      </div>

      <div className="gallery">
        <div className="gallery-main">
          <img src={gymImage(gym.imageSeeds[activeImg], 1000, 680)} alt={`${gym.title} view ${activeImg + 1}`} />
          {gym.imageSeeds.length > 1 && (
            <>
              <button
                className="gallery-nav gallery-prev"
                onClick={() => setActiveImg((i) => (i - 1 + gym.imageSeeds.length) % gym.imageSeeds.length)}
                aria-label="Previous photo"
              >
                <Icon name="chevron-left" size={22} />
              </button>
              <button
                className="gallery-nav gallery-next"
                onClick={() => setActiveImg((i) => (i + 1) % gym.imageSeeds.length)}
                aria-label="Next photo"
              >
                <Icon name="chevron-right" size={22} />
              </button>
            </>
          )}
        </div>
        {gym.imageSeeds.length > 1 && (
          <div className="gallery-thumbs">
            {gym.imageSeeds.map((seed, i) => (
              <button
                key={seed}
                className={`gallery-thumb ${i === activeImg ? 'is-active' : ''}`}
                onClick={() => setActiveImg(i)}
                aria-label={`Photo ${i + 1}`}
              >
                <img src={gymImage(seed, 200, 140)} alt="" />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="detail-body">
        <div className="detail-main">
          <section className="detail-host">
            <img className="host-avatar" src={avatar(gym.hostAvatarSeed, initialsOf(gym.host))} alt={gym.host} />
            <div>
              <h2 className="detail-section-title">
                {gym.gymType} garage hosted by {gym.host}
              </h2>
              <p className="detail-host-meta">
                Hosting since {gym.hostSince} · {gym.sizeSqFt} sq ft · up to {gym.maxLifters} lifters
              </p>
            </div>
          </section>

          <div className="quick-facts">
            <div className="quick-fact">
              <Icon name="dumbbell" size={20} />
              <div>
                <strong>{gym.gymType}</strong>
                <span>Focus</span>
              </div>
            </div>
            <div className="quick-fact">
              <Icon name="ruler" size={20} />
              <div>
                <strong>{gym.sizeSqFt} sq ft</strong>
                <span>Space</span>
              </div>
            </div>
            <div className="quick-fact">
              <Icon name="users" size={20} />
              <div>
                <strong>{gym.maxLifters} lifters</strong>
                <span>Max capacity</span>
              </div>
            </div>
            <div className="quick-fact">
              <Icon name={gym.instantBook ? 'bolt' : 'clock'} size={20} />
              <div>
                <strong>{gym.instantBook ? 'Instant' : 'Request'}</strong>
                <span>Booking</span>
              </div>
            </div>
          </div>

          <section className="detail-section">
            <p className="detail-desc">{gym.description}</p>
          </section>

          <section className="detail-section">
            <h2 className="detail-section-title">Equipment</h2>
            <ul className="equip-list">
              {gym.equipment.map((e) => (
                <li key={e}>
                  <Icon name="check" size={16} /> {e}
                </li>
              ))}
            </ul>
          </section>

          <section className="detail-section">
            <h2 className="detail-section-title">Amenities</h2>
            <ul className="amenity-list">
              {gym.amenities.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>

          <section className="detail-section detail-two-col">
            <div>
              <h2 className="detail-section-title">Availability</h2>
              <p className="avail-line">
                <Icon name="calendar" size={16} /> {shortDays(gym.availableDays)}
              </p>
              <p className="avail-line">
                <Icon name="clock" size={16} /> {hourLabel(gym.openHour)} – {hourLabel(gym.closeHour)}
              </p>
            </div>
            <div>
              <h2 className="detail-section-title">House rules</h2>
              <ul className="rules-list">
                {gym.rules.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </section>

          <section className="detail-section">
            <h2 className="detail-section-title">
              <Icon name="star" size={17} /> {gym.rating.toFixed(2)} · {gym.reviewCount} reviews
            </h2>
            <div className="reviews">
              {gym.reviews.map((rev) => (
                <div key={rev.id} className="review">
                  <div className="review-head">
                    <img className="review-avatar" src={avatar(rev.avatarSeed, initialsOf(rev.author))} alt={rev.author} />
                    <div>
                      <strong>{rev.author}</strong>
                      <span className="review-date">{rev.date}</span>
                    </div>
                    <span className="review-rating">
                      <Icon name="star" size={12} /> {rev.rating.toFixed(1)}
                    </span>
                  </div>
                  <p className="review-body">{rev.body}</p>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="detail-side">
          <BookingWidget gym={gym} onBook={onBook} />
        </div>
      </div>
    </div>
  )
}
