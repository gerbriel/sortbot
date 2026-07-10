import { useMemo, useState } from 'react'
import type { Booking, Gym } from '../types'
import { gymImage } from '../lib/images'
import { hourLabel, money } from '../lib/format'
import Icon from './Icon'

interface CheckoutProps {
  gym: Gym
  booking: Booking
  subtotal: number
  serviceFee: number
  onPaid: () => void
  onClose: () => void
}

type Brand = 'visa' | 'mastercard' | 'amex' | 'card'

function detectBrand(digits: string): Brand {
  if (/^4/.test(digits)) return 'visa'
  if (/^3[47]/.test(digits)) return 'amex'
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard'
  return 'card'
}

const BRAND_LABEL: Record<Brand, string> = {
  visa: 'VISA',
  mastercard: 'Mastercard',
  amex: 'AMEX',
  card: 'Card',
}

function groupCard(digits: string, brand: Brand): string {
  if (brand === 'amex') {
    return digits.replace(/(\d{1,4})(\d{1,6})?(\d{1,5})?/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join(' '),
    )
  }
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim()
}

export default function Checkout({ gym, booking, subtotal, serviceFee, onPaid, onClose }: CheckoutProps) {
  const [name, setName] = useState('')
  const [rawNumber, setRawNumber] = useState('')
  const [expiry, setExpiry] = useState('')
  const [cvc, setCvc] = useState('')
  const [zip, setZip] = useState('')
  const [status, setStatus] = useState<'idle' | 'processing'>('idle')
  const [touched, setTouched] = useState(false)

  const brand = useMemo(() => detectBrand(rawNumber), [rawNumber])
  const maxLen = brand === 'amex' ? 15 : 16
  const cvcLen = brand === 'amex' ? 4 : 3

  const numberValid = rawNumber.length === maxLen
  const expiryValid = /^\d{2}\/\d{2}$/.test(expiry) && Number(expiry.slice(0, 2)) >= 1 && Number(expiry.slice(0, 2)) <= 12
  const cvcValid = cvc.length === cvcLen
  const nameValid = name.trim().length >= 2
  const zipValid = zip.length >= 4
  const formValid = numberValid && expiryValid && cvcValid && nameValid && zipValid

  function onNumberChange(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, brand === 'amex' ? 15 : 16)
    setRawNumber(digits)
  }
  function onExpiryChange(v: string) {
    const digits = v.replace(/\D/g, '').slice(0, 4)
    setExpiry(digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits)
  }

  function fillTestCard() {
    setName(name || 'Alex Lifter')
    setRawNumber('4242424242424242')
    setExpiry('12/28')
    setCvc('123')
    setZip('80211')
  }

  function handlePay() {
    setTouched(true)
    if (!formValid || status === 'processing') return
    setStatus('processing')
    window.setTimeout(() => {
      onPaid()
    }, 1100)
  }

  const displayNumber = groupCard(rawNumber, brand).padEnd(brand === 'amex' ? 17 : 19, '•')

  return (
    <div className="checkout-overlay" role="dialog" aria-modal="true" aria-label="Checkout">
      <div className="checkout-scrim" onClick={status === 'idle' ? onClose : undefined} />
      <div className="checkout-modal">
        <button className="checkout-close" onClick={onClose} aria-label="Close checkout" disabled={status === 'processing'}>
          <Icon name="close" size={20} />
        </button>

        <div className="checkout-grid">
          <div className="checkout-pay">
            <h2 className="checkout-title">Confirm and pay</h2>
            <p className="checkout-demo">
              <Icon name="shield" size={14} /> Demo checkout — no real card is charged.
              <button type="button" className="link-btn checkout-testfill" onClick={fillTestCard}>
                Use test card
              </button>
            </p>

            <div className={`card-preview card-preview--${brand}`}>
              <div className="card-preview-top">
                <span className="card-chip" />
                <span className="card-brand">{BRAND_LABEL[brand]}</span>
              </div>
              <div className="card-number">{displayNumber}</div>
              <div className="card-preview-bottom">
                <div>
                  <span className="card-label">Card holder</span>
                  <span className="card-value">{name || 'YOUR NAME'}</span>
                </div>
                <div>
                  <span className="card-label">Expires</span>
                  <span className="card-value">{expiry || 'MM/YY'}</span>
                </div>
              </div>
            </div>

            <div className="checkout-form">
              <label className="co-field co-field--full">
                <span className="field-label">Name on card</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Lifter" autoComplete="off" />
                {touched && !nameValid && <span className="co-err">Enter the name on the card.</span>}
              </label>

              <label className="co-field co-field--full">
                <span className="field-label">Card number</span>
                <input
                  inputMode="numeric"
                  value={groupCard(rawNumber, brand)}
                  onChange={(e) => onNumberChange(e.target.value)}
                  placeholder="1234 1234 1234 1234"
                />
                {touched && !numberValid && <span className="co-err">Enter a {maxLen}-digit card number.</span>}
              </label>

              <label className="co-field">
                <span className="field-label">Expiry</span>
                <input inputMode="numeric" value={expiry} onChange={(e) => onExpiryChange(e.target.value)} placeholder="MM/YY" />
                {touched && !expiryValid && <span className="co-err">MM/YY</span>}
              </label>
              <label className="co-field">
                <span className="field-label">CVC</span>
                <input
                  inputMode="numeric"
                  value={cvc}
                  onChange={(e) => setCvc(e.target.value.replace(/\D/g, '').slice(0, cvcLen))}
                  placeholder={brand === 'amex' ? '1234' : '123'}
                />
                {touched && !cvcValid && <span className="co-err">{cvcLen} digits</span>}
              </label>
              <label className="co-field">
                <span className="field-label">ZIP</span>
                <input
                  inputMode="numeric"
                  value={zip}
                  onChange={(e) => setZip(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="80211"
                />
                {touched && !zipValid && <span className="co-err">ZIP</span>}
              </label>
            </div>
          </div>

          <aside className="checkout-summary">
            <div className="co-gym">
              <img src={gymImage(gym.imageSeeds[0], 240, 170)} alt={gym.title} />
              <div>
                <h3>{gym.title}</h3>
                <p>
                  {gym.neighborhood}, {gym.city}
                </p>
                <span className="co-gym-rating">
                  <Icon name="star" size={12} /> {gym.rating.toFixed(2)} · {gym.reviewCount} reviews
                </span>
              </div>
            </div>

            <div className="co-detail-rows">
              <div>
                <Icon name="calendar" size={15} />
                {new Date(booking.date + 'T00:00').toLocaleDateString(undefined, {
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                })}
              </div>
              <div>
                <Icon name="clock" size={15} />
                {hourLabel(booking.startHour)} · {booking.hours} {booking.hours === 1 ? 'hour' : 'hours'}
              </div>
              <div>
                <Icon name="users" size={15} />
                {booking.lifters} {booking.lifters === 1 ? 'lifter' : 'lifters'}
              </div>
            </div>

            <div className="co-breakdown">
              <div className="co-row">
                <span>
                  {money(gym.pricePerHour)} × {booking.hours} {booking.hours === 1 ? 'hour' : 'hours'}
                </span>
                <span>{money(subtotal)}</span>
              </div>
              <div className="co-row">
                <span>Service fee</span>
                <span>{money(serviceFee)}</span>
              </div>
              <div className="co-row co-row--total">
                <span>Total (USD)</span>
                <span>{money(booking.total)}</span>
              </div>
            </div>

            <button className="btn btn-primary btn-block co-pay" disabled={status === 'processing'} onClick={handlePay}>
              {status === 'processing' ? (
                <>
                  <span className="co-spinner" /> Processing…
                </>
              ) : (
                <>Pay {money(booking.total)}</>
              )}
            </button>
            <p className="co-fineprint">
              {gym.instantBook
                ? "You'll be charged now and your session is confirmed instantly."
                : `You'll be charged when ${gym.host} accepts your request.`}
            </p>
          </aside>
        </div>
      </div>
    </div>
  )
}
