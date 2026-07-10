import { useEffect, useMemo, useState } from 'react'
import type { Booking, Gym } from './types'
import { SEED_GYMS } from './data/gyms'
import {
  loadBookings,
  saveBookings,
  loadFavorites,
  saveFavorites,
  loadUserListings,
  saveUserListings,
} from './lib/storage'
import Header from './components/Header'
import Filters, { DEFAULT_FILTERS } from './components/Filters'
import type { FilterState } from './components/Filters'
import GymGrid from './components/GymGrid'
import GymDetail from './components/GymDetail'
import HostForm from './components/HostForm'
import TripsView from './components/TripsView'
import Icon from './components/Icon'

export type View =
  | { name: 'browse' }
  | { name: 'detail'; id: string }
  | { name: 'host' }
  | { name: 'trips' }
  | { name: 'favorites' }

export default function App() {
  const [view, setView] = useState<View>({ name: 'browse' })
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS)
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites())
  const [bookings, setBookings] = useState<Booking[]>(() => loadBookings())
  const [userListings, setUserListings] = useState<Gym[]>(() => loadUserListings())

  useEffect(() => saveFavorites(favorites), [favorites])
  useEffect(() => saveBookings(bookings), [bookings])
  useEffect(() => saveUserListings(userListings), [userListings])

  // Scroll to top on view change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' })
  }, [view])

  const allGyms = useMemo(() => [...userListings, ...SEED_GYMS], [userListings])

  const filtered = useMemo(() => {
    const q = filters.query.trim().toLowerCase()
    let list = allGyms.filter((g) => {
      if (filters.gymType !== 'All' && g.gymType !== filters.gymType) return false
      if (filters.maxPrice < 30 && g.pricePerHour > filters.maxPrice) return false
      if (filters.instantOnly && !g.instantBook) return false
      if (filters.superhostOnly && !g.superhost) return false
      if (q) {
        const hay = [g.title, g.city, g.state, g.neighborhood, g.gymType, ...g.equipment, ...g.amenities]
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })

    switch (filters.sort) {
      case 'price-asc':
        list = [...list].sort((a, b) => a.pricePerHour - b.pricePerHour)
        break
      case 'price-desc':
        list = [...list].sort((a, b) => b.pricePerHour - a.pricePerHour)
        break
      case 'rating':
        list = [...list].sort((a, b) => b.rating - a.rating)
        break
      default:
        list = [...list].sort(
          (a, b) => Number(b.superhost) - Number(a.superhost) || b.rating - a.rating,
        )
    }
    return list
  }, [allGyms, filters])

  const favoriteGyms = useMemo(() => allGyms.filter((g) => favorites.includes(g.id)), [allGyms, favorites])
  const currentGym = view.name === 'detail' ? allGyms.find((g) => g.id === view.id) : undefined

  function patchFilters(patch: Partial<FilterState>) {
    setFilters((f) => ({ ...f, ...patch }))
  }

  function toggleFavorite(id: string) {
    setFavorites((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleBook(booking: Booking) {
    setBookings((prev) => [...prev, booking])
  }

  function handleCancelBooking(id: string) {
    setBookings((prev) => prev.filter((b) => b.id !== id))
  }

  function handleCreateListing(gym: Gym) {
    setUserListings((prev) => [gym, ...prev])
    setView({ name: 'detail', id: gym.id })
  }

  return (
    <div className="app">
      <Header
        view={view}
        favoritesCount={favorites.length}
        tripsCount={bookings.length}
        onNavigate={setView}
      />

      <main className="app-main">
        {view.name === 'browse' && (
          <>
            <section className="hero">
              <div className="hero-content">
                <h1 className="hero-title">Rent a garage gym by the hour</h1>
                <p className="hero-sub">
                  Real racks, real barbells, real platforms — hosted by lifters near you. No membership, no crowds,
                  no waiting for the squat rack.
                </p>
                <div className="hero-stats">
                  <div>
                    <strong>{allGyms.length}</strong>
                    <span>gyms listed</span>
                  </div>
                  <div>
                    <strong>8</strong>
                    <span>cities</span>
                  </div>
                  <div>
                    <strong>4.9★</strong>
                    <span>avg rating</span>
                  </div>
                </div>
              </div>
            </section>

            <Filters
              filters={filters}
              resultCount={filtered.length}
              onChange={patchFilters}
              onReset={() => setFilters(DEFAULT_FILTERS)}
            />

            <GymGrid
              gyms={filtered}
              favorites={favorites}
              onOpen={(id) => setView({ name: 'detail', id })}
              onToggleFavorite={toggleFavorite}
            />
          </>
        )}

        {view.name === 'detail' &&
          (currentGym ? (
            <GymDetail
              gym={currentGym}
              isFavorite={favorites.includes(currentGym.id)}
              onBack={() => setView({ name: 'browse' })}
              onBook={handleBook}
              onToggleFavorite={toggleFavorite}
            />
          ) : (
            <div className="empty-state empty-state--cta">
              <p>This listing is no longer available.</p>
              <button className="btn btn-primary" onClick={() => setView({ name: 'browse' })}>
                Back to explore
              </button>
            </div>
          ))}

        {view.name === 'favorites' && (
          <div className="favorites-page">
            <h1 className="page-title">
              <Icon name="heart-filled" size={24} /> Saved gyms
            </h1>
            <GymGrid
              gyms={favoriteGyms}
              favorites={favorites}
              emptyMessage="No saved gyms yet. Tap the heart on any listing to save it here."
              onOpen={(id) => setView({ name: 'detail', id })}
              onToggleFavorite={toggleFavorite}
            />
          </div>
        )}

        {view.name === 'trips' && (
          <TripsView
            bookings={bookings}
            onOpenGym={(id) => setView({ name: 'detail', id })}
            onCancel={handleCancelBooking}
            onBrowse={() => setView({ name: 'browse' })}
          />
        )}

        {view.name === 'host' && (
          <HostForm onCreate={handleCreateListing} onCancel={() => setView({ name: 'browse' })} />
        )}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <span className="brand-name footer-brand">
            Garage<span className="brand-accent">Gains</span>
          </span>
          <p>Built as a demo marketplace — bookings and listings are stored locally in your browser.</p>
        </div>
      </footer>
    </div>
  )
}
