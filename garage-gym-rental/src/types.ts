export type GymType =
  | 'Powerlifting'
  | 'Olympic Lifting'
  | 'CrossFit / Functional'
  | 'Bodybuilding'
  | 'Strongman'
  | 'Cardio & Conditioning'

export const GYM_TYPES: GymType[] = [
  'Powerlifting',
  'Olympic Lifting',
  'CrossFit / Functional',
  'Bodybuilding',
  'Strongman',
  'Cardio & Conditioning',
]

export interface Review {
  id: string
  author: string
  avatarSeed: string
  rating: number
  date: string
  body: string
}

export interface Gym {
  id: string
  title: string
  host: string
  hostSince: string
  hostAvatarSeed: string
  superhost: boolean
  city: string
  state: string
  neighborhood: string
  pricePerHour: number
  rating: number
  reviewCount: number
  imageSeeds: string[]
  gymType: GymType
  sizeSqFt: number
  maxLifters: number
  description: string
  equipment: string[]
  amenities: string[]
  rules: string[]
  instantBook: boolean
  /** Days of week available, 0 = Sunday ... 6 = Saturday */
  availableDays: number[]
  /** Hour the gym opens (24h) */
  openHour: number
  /** Hour the gym closes (24h) */
  closeHour: number
  reviews: Review[]
  /** True when this listing was created locally by the current user (host mode). */
  userListed?: boolean
}

export interface Booking {
  id: string
  gymId: string
  gymTitle: string
  gymImageSeed: string
  city: string
  state: string
  date: string // YYYY-MM-DD
  startHour: number
  hours: number
  lifters: number
  pricePerHour: number
  total: number
  createdAt: number
}
