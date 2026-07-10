import type { Booking, Gym } from '../types'

const BOOKINGS_KEY = 'gg_bookings'
const FAVORITES_KEY = 'gg_favorites'
const LISTINGS_KEY = 'gg_user_listings'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore quota / private-mode errors
  }
}

export function loadBookings(): Booking[] {
  return read<Booking[]>(BOOKINGS_KEY, [])
}

export function saveBookings(bookings: Booking[]): void {
  write(BOOKINGS_KEY, bookings)
}

export function loadFavorites(): string[] {
  return read<string[]>(FAVORITES_KEY, [])
}

export function saveFavorites(ids: string[]): void {
  write(FAVORITES_KEY, ids)
}

export function loadUserListings(): Gym[] {
  return read<Gym[]>(LISTINGS_KEY, [])
}

export function saveUserListings(gyms: Gym[]): void {
  write(LISTINGS_KEY, gyms)
}
