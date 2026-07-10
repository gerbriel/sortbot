# 🏋️ GarageGains

An **Airbnb-style marketplace for renting out garage gyms by the hour.** Lifters
find and book real home-gym setups near them — a competition powerlifting garage,
an Olympic-lifting shed with a drop platform, a strongman yard with atlas stones —
and hosts turn their home iron into income.

Built with **React 19 + Vite + TypeScript**, no backend required. Listings and
imagery are generated locally (deterministic SVG "photos"), and your bookings,
saved gyms, and any listings you publish persist in `localStorage`.

## Features

- **Explore** a grid of garage gyms with photos, price/hr, rating, Superhost &
  Instant-book badges.
- **Search & filter** by city, equipment, gym focus (Powerlifting, Olympic,
  CrossFit/Functional, Bodybuilding, Strongman, Cardio & Conditioning), max
  price, Instant-book, and Superhost — plus sort by price or rating.
- **Listing detail** page: photo gallery, equipment & amenities, availability,
  house rules, host card, and reviews.
- **Booking widget** — pick a date, start time, duration and number of lifters;
  it validates the gym's open days, shows a live price breakdown with service
  fee, and confirms the reservation.
- **My bookings** — review and cancel your booked sessions.
- **Saved gyms** — heart any listing to save it.
- **List your gym** — a full host form that publishes a new listing into the
  marketplace instantly.
- Fully **responsive** with a clean Airbnb-inspired design system.

## Run it

```bash
cd garage-gym-rental
npm install
npm run dev        # http://localhost:5173
```

Build & preview a production bundle:

```bash
npm run build
npm run preview
```

## Project structure

```
src/
├── App.tsx                 # Root: view routing, filters, state, persistence
├── types.ts                # Gym / Booking / Review models
├── data/gyms.ts            # 8 seed listings across 8 cities
├── lib/
│   ├── images.ts           # Deterministic SVG gym "photos" + avatars
│   ├── format.ts           # Money / time / date helpers
│   └── storage.ts          # localStorage for bookings, favorites, listings
└── components/
    ├── Header.tsx          # Nav + booking/favorites counts
    ├── Filters.tsx         # Search bar, type chips, price, sort
    ├── GymGrid.tsx         # Results grid
    ├── GymCard.tsx         # Listing card
    ├── GymDetail.tsx       # Full listing page + gallery + reviews
    ├── BookingWidget.tsx   # Date/time/price reservation flow
    ├── HostForm.tsx        # Publish a new listing
    ├── TripsView.tsx       # My bookings
    └── Icon.tsx            # Inline SVG icon set (no icon dependency)
```

> Demo app — no real payments, accounts, or servers. Everything lives in your
> browser.
