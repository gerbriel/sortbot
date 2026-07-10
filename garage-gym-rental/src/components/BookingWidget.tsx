import { useMemo, useState } from 'react'
import type { Booking, Gym } from '../types'
import { hourLabel, money, todayIso, weekdayOf, longDay } from '../lib/format'
import Icon from './Icon'

interface BookingWidgetProps {
  gym: Gym
  onBook: (booking: Booking) => void
}

const SERVICE_FEE_RATE = 0.1

export default function BookingWidget({ gym, onBook }: BookingWidgetProps) {
  const [date, setDate] = useState('')
  const [startHour, setStartHour] = useState(gym.openHour + 1)
  const [hours, setHours] = useState(1)
  const [lifters, setLifters] = useState(1)
  const [confirmed, setConfirmed] = useState<Booking | null>(null)

  const startOptions = useMemo(() => {
    const opts: number[] = []
    for (let h = gym.openHour; h <= gym.closeHour - 1; h++) opts.push(h)
    return opts
  }, [gym.openHour, gym.closeHour])

  const maxHours = Math.max(1, gym.closeHour - startHour)
  const effectiveHours = Math.min(hours, maxHours)

  const subtotal = gym.pricePerHour * effectiveHours
  const serviceFee = Math.round(subtotal * SERVICE_FEE_RATE * 100) / 100
  const total = subtotal + serviceFee

  const dateChosen = date !== ''
  const dayOk = dateChosen ? gym.availableDays.includes(weekdayOf(date)) : true
  const canBook = dateChosen && dayOk

  function handleReserve() {
    if (!canBook) return
    const booking: Booking = {
      id: `bk-${Date.now()}-${Math.floor((startHour * 1000 + effectiveHours))}`,
      gymId: gym.id,
      gymTitle: gym.title,
      gymImageSeed: gym.imageSeeds[0],
      city: gym.city,
      state: gym.state,
      date,
      startHour,
      hours: effectiveHours,
      lifters,
      pricePerHour: gym.pricePerHour,
      total,
      createdAt: Date.now(),
    }
    onBook(booking)
    setConfirmed(booking)
  }

  if (confirmed) {
    return (
      <aside className="booking-card booking-card--done">
        <div className="booking-done-icon">
          <Icon name="check" size={30} />
        </div>
        <h3>{gym.instantBook ? "You're booked!" : 'Request sent!'}</h3>
        <p className="booking-done-sub">
          {gym.instantBook
            ? `Your session at ${gym.title.split('—')[0].trim()} is confirmed.`
            : `${gym.host} will confirm your request shortly.`}
        </p>
        <div className="booking-done-detail">
          <div>
            <Icon name="calendar" size={16} /> {new Date(confirmed.date + 'T00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <div>
            <Icon name="clock" size={16} /> {hourLabel(confirmed.startHour)} · {confirmed.hours} {confirmed.hours === 1 ? 'hour' : 'hours'}
          </div>
          <div>
            <Icon name="users" size={16} /> {confirmed.lifters} {confirmed.lifters === 1 ? 'lifter' : 'lifters'}
          </div>
        </div>
        <div className="booking-total-row">
          <span>Total paid</span>
          <strong>{money(confirmed.total)}</strong>
        </div>
        <button className="btn btn-ghost btn-block" onClick={() => setConfirmed(null)}>
          Book another session
        </button>
      </aside>
    )
  }

  return (
    <aside className="booking-card">
      <div className="booking-price">
        <span className="booking-price-amount">{money(gym.pricePerHour)}</span>
        <span className="booking-price-unit">/ hour</span>
        <span className="booking-price-rating">
          <Icon name="star" size={13} /> {gym.rating.toFixed(2)} · {gym.reviewCount} reviews
        </span>
      </div>

      <div className="booking-fields">
        <label className="field">
          <span className="field-label">Date</span>
          <input type="date" min={todayIso()} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>

        <div className="field-pair">
          <label className="field">
            <span className="field-label">Start</span>
            <select value={startHour} onChange={(e) => setStartHour(Number(e.target.value))}>
              {startOptions.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Hours</span>
            <select value={effectiveHours} onChange={(e) => setHours(Number(e.target.value))}>
              {Array.from({ length: maxHours }, (_, i) => i + 1).map((h) => (
                <option key={h} value={h}>
                  {h} {h === 1 ? 'hour' : 'hours'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="field">
          <span className="field-label">Lifters</span>
          <select value={lifters} onChange={(e) => setLifters(Number(e.target.value))}>
            {Array.from({ length: gym.maxLifters }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? 'lifter' : 'lifters'}
              </option>
            ))}
          </select>
        </label>
      </div>

      {dateChosen && !dayOk && (
        <p className="booking-warn">
          <Icon name="close" size={14} /> Not open on {longDay(weekdayOf(date))}. Open {gym.availableDays.length} days/week.
        </p>
      )}

      <button className="btn btn-primary btn-block" disabled={!canBook} onClick={handleReserve}>
        {gym.instantBook ? 'Reserve' : 'Request to book'}
      </button>
      {!dateChosen && <p className="booking-hint">Select a date to check availability — you won't be charged yet.</p>}

      {dateChosen && dayOk && (
        <div className="booking-breakdown">
          <div className="breakdown-row">
            <span>
              {money(gym.pricePerHour)} × {effectiveHours} {effectiveHours === 1 ? 'hour' : 'hours'}
            </span>
            <span>{money(subtotal)}</span>
          </div>
          <div className="breakdown-row">
            <span>Service fee</span>
            <span>{money(serviceFee)}</span>
          </div>
          <div className="breakdown-row breakdown-total">
            <span>Total</span>
            <span>{money(total)}</span>
          </div>
        </div>
      )}
    </aside>
  )
}
