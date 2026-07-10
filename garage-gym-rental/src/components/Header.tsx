import Icon from './Icon'
import type { View } from '../App'

interface HeaderProps {
  view: View
  favoritesCount: number
  tripsCount: number
  onNavigate: (view: View) => void
}

export default function Header({ view, favoritesCount, tripsCount, onNavigate }: HeaderProps) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button className="brand" onClick={() => onNavigate({ name: 'browse' })} aria-label="GarageGains home">
          <span className="brand-mark">
            <Icon name="dumbbell" size={22} />
          </span>
          <span className="brand-name">
            Garage<span className="brand-accent">Gains</span>
          </span>
        </button>

        <nav className="header-nav">
          <button
            className={`nav-link ${view.name === 'browse' ? 'is-active' : ''}`}
            onClick={() => onNavigate({ name: 'browse' })}
          >
            Explore
          </button>
          <button
            className={`nav-link ${view.name === 'trips' ? 'is-active' : ''}`}
            onClick={() => onNavigate({ name: 'trips' })}
          >
            My bookings
            {tripsCount > 0 && <span className="nav-badge">{tripsCount}</span>}
          </button>
          <button
            className={`nav-link nav-link--icon ${view.name === 'favorites' ? 'is-active' : ''}`}
            onClick={() => onNavigate({ name: 'favorites' })}
            aria-label="Saved gyms"
          >
            <Icon name={favoritesCount > 0 ? 'heart-filled' : 'heart'} size={18} />
            {favoritesCount > 0 && <span className="nav-badge">{favoritesCount}</span>}
          </button>
          <button className="btn btn-primary btn-host" onClick={() => onNavigate({ name: 'host' })}>
            <Icon name="plus" size={16} /> List your gym
          </button>
        </nav>
      </div>
    </header>
  )
}
