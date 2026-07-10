import { useState } from 'react'
import { GYM_TYPES } from '../types'
import type { Gym, GymType } from '../types'
import Icon from './Icon'

interface HostFormProps {
  onCreate: (gym: Gym) => void
  onCancel: () => void
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export default function HostForm({ onCreate, onCancel }: HostFormProps) {
  const [title, setTitle] = useState('')
  const [hostName, setHostName] = useState('')
  const [city, setCity] = useState('')
  const [stateAbbr, setStateAbbr] = useState('')
  const [neighborhood, setNeighborhood] = useState('')
  const [gymType, setGymType] = useState<GymType>('Powerlifting')
  const [price, setPrice] = useState('18')
  const [size, setSize] = useState('400')
  const [maxLifters, setMaxLifters] = useState('2')
  const [description, setDescription] = useState('')
  const [equipment, setEquipment] = useState('')
  const [amenities, setAmenities] = useState('')
  const [instantBook, setInstantBook] = useState(true)
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5])
  const [error, setError] = useState('')

  function toggleDay(d: number) {
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)))
  }

  function splitList(v: string): string[] {
    return v
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !city.trim() || !stateAbbr.trim()) {
      setError('Please fill in a title, city, and state.')
      return
    }
    if (days.length === 0) {
      setError('Pick at least one available day.')
      return
    }
    const equip = splitList(equipment)
    if (equip.length === 0) {
      setError('List at least one piece of equipment.')
      return
    }

    const id = `user-${Date.now()}`
    const gym: Gym = {
      id,
      title: title.trim(),
      host: hostName.trim() || 'You',
      hostSince: String(new Date().getFullYear()),
      hostAvatarSeed: id,
      superhost: false,
      city: city.trim(),
      state: stateAbbr.trim().toUpperCase().slice(0, 2),
      neighborhood: neighborhood.trim() || 'Downtown',
      pricePerHour: Math.max(1, Number(price) || 18),
      rating: 5,
      reviewCount: 0,
      imageSeeds: [`${id}-a`, `${id}-b`, `${id}-c`],
      gymType,
      sizeSqFt: Math.max(50, Number(size) || 400),
      maxLifters: Math.max(1, Number(maxLifters) || 2),
      description:
        description.trim() ||
        `A ${gymType.toLowerCase()} garage gym in ${city.trim()}. Book a session and train on real equipment.`,
      equipment: equip,
      amenities: splitList(amenities).length ? splitList(amenities) : ['Free parking', 'Water'],
      rules: ['Wipe down equipment', 'Rerack your weights'],
      instantBook,
      availableDays: days,
      openHour: 6,
      closeHour: 21,
      reviews: [],
      userListed: true,
    }
    onCreate(gym)
  }

  return (
    <div className="host-page">
      <button className="back-link" onClick={onCancel}>
        <Icon name="arrow-left" size={18} /> Back
      </button>

      <div className="host-hero">
        <h1>List your garage gym</h1>
        <p>Turn your home setup into income. Lifters near you are looking for real iron by the hour.</p>
      </div>

      <form className="host-form" onSubmit={handleSubmit}>
        <div className="form-grid">
          <label className="field field--full">
            <span className="field-label">Listing title *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Competition Powerlifting Garage — calibrated plates"
            />
          </label>

          <label className="field">
            <span className="field-label">Your name</span>
            <input value={hostName} onChange={(e) => setHostName(e.target.value)} placeholder="Host name" />
          </label>
          <label className="field">
            <span className="field-label">Gym focus</span>
            <select value={gymType} onChange={(e) => setGymType(e.target.value as GymType)}>
              {GYM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">City *</span>
            <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Denver" />
          </label>
          <label className="field">
            <span className="field-label">State *</span>
            <input value={stateAbbr} onChange={(e) => setStateAbbr(e.target.value)} placeholder="CO" maxLength={2} />
          </label>
          <label className="field">
            <span className="field-label">Neighborhood</span>
            <input value={neighborhood} onChange={(e) => setNeighborhood(e.target.value)} placeholder="Berkeley" />
          </label>

          <label className="field">
            <span className="field-label">Price / hour ($)</span>
            <input type="number" min={1} value={price} onChange={(e) => setPrice(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Size (sq ft)</span>
            <input type="number" min={50} value={size} onChange={(e) => setSize(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">Max lifters</span>
            <input type="number" min={1} value={maxLifters} onChange={(e) => setMaxLifters(e.target.value)} />
          </label>

          <label className="field field--full">
            <span className="field-label">Description</span>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell lifters what makes your space great…"
            />
          </label>

          <label className="field field--full">
            <span className="field-label">Equipment * (one per line or comma-separated)</span>
            <textarea
              rows={3}
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
              placeholder={'Power rack\nOlympic barbell\nBumper plates'}
            />
          </label>

          <label className="field field--full">
            <span className="field-label">Amenities (comma-separated)</span>
            <input
              value={amenities}
              onChange={(e) => setAmenities(e.target.value)}
              placeholder="Free parking, Bathroom, Water, AC"
            />
          </label>

          <div className="field field--full">
            <span className="field-label">Available days</span>
            <div className="day-picker">
              {WEEKDAYS.map((label, i) => (
                <button
                  type="button"
                  key={label}
                  className={`day-btn ${days.includes(i) ? 'is-on' : ''}`}
                  onClick={() => toggleDay(i)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="field field--full checkbox-field">
            <input type="checkbox" checked={instantBook} onChange={(e) => setInstantBook(e.target.checked)} />
            <span>
              <strong>Instant book</strong> — let lifters reserve without approval
            </span>
          </label>
        </div>

        {error && (
          <p className="form-error">
            <Icon name="close" size={15} /> {error}
          </p>
        )}

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Publish listing
          </button>
        </div>
      </form>
    </div>
  )
}
