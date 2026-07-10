import { GYM_TYPES } from '../types'
import type { GymType } from '../types'
import { money } from '../lib/format'
import Icon from './Icon'

export interface FilterState {
  query: string
  gymType: GymType | 'All'
  maxPrice: number
  instantOnly: boolean
  superhostOnly: boolean
  sort: SortKey
}

export type SortKey = 'recommended' | 'price-asc' | 'price-desc' | 'rating'

export const DEFAULT_FILTERS: FilterState = {
  query: '',
  gymType: 'All',
  maxPrice: 30,
  instantOnly: false,
  superhostOnly: false,
  sort: 'recommended',
}

interface FiltersProps {
  filters: FilterState
  resultCount: number
  onChange: (patch: Partial<FilterState>) => void
  onReset: () => void
}

export default function Filters({ filters, resultCount, onChange, onReset }: FiltersProps) {
  const isDefault =
    filters.gymType === 'All' &&
    filters.maxPrice >= 30 &&
    !filters.instantOnly &&
    !filters.superhostOnly &&
    filters.query.trim() === ''

  return (
    <div className="filters">
      <div className="search-field">
        <Icon name="search" size={18} />
        <input
          type="text"
          placeholder="Search by city, gym type, or equipment…"
          value={filters.query}
          onChange={(e) => onChange({ query: e.target.value })}
          aria-label="Search gyms"
        />
        {filters.query && (
          <button className="search-clear" onClick={() => onChange({ query: '' })} aria-label="Clear search">
            <Icon name="close" size={16} />
          </button>
        )}
      </div>

      <div className="filter-row">
        <div className="chip-scroll">
          <button
            className={`type-chip ${filters.gymType === 'All' ? 'is-active' : ''}`}
            onClick={() => onChange({ gymType: 'All' })}
          >
            All types
          </button>
          {GYM_TYPES.map((t) => (
            <button
              key={t}
              className={`type-chip ${filters.gymType === t ? 'is-active' : ''}`}
              onClick={() => onChange({ gymType: filters.gymType === t ? 'All' : t })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-row filter-row--controls">
        <label className="price-filter">
          <span>
            Max price: <strong>{filters.maxPrice >= 30 ? 'Any' : `${money(filters.maxPrice)}/hr`}</strong>
          </span>
          <input
            type="range"
            min={10}
            max={30}
            step={1}
            value={filters.maxPrice}
            onChange={(e) => onChange({ maxPrice: Number(e.target.value) })}
          />
        </label>

        <button
          className={`toggle-pill ${filters.instantOnly ? 'is-on' : ''}`}
          onClick={() => onChange({ instantOnly: !filters.instantOnly })}
        >
          <Icon name="bolt" size={14} /> Instant book
        </button>
        <button
          className={`toggle-pill ${filters.superhostOnly ? 'is-on' : ''}`}
          onClick={() => onChange({ superhostOnly: !filters.superhostOnly })}
        >
          <Icon name="shield" size={14} /> Superhost
        </button>

        <select
          className="sort-select"
          value={filters.sort}
          onChange={(e) => onChange({ sort: e.target.value as SortKey })}
          aria-label="Sort results"
        >
          <option value="recommended">Recommended</option>
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="rating">Top rated</option>
        </select>
      </div>

      <div className="filter-summary">
        <span>
          {resultCount} {resultCount === 1 ? 'gym' : 'gyms'} available
        </span>
        {!isDefault && (
          <button className="link-btn" onClick={onReset}>
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}
