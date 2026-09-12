# City Resilience Simulator

A lightweight, map-style city-building challenge. Each registered team can create one city, save progress before submission, and run one final simulation. An administrator can log in separately to view rankings and event outcomes.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Demo administrator account

- Email: `admin@citysim.local`
- Password: `admin123`

Change these before a real event by setting environment variables:

```powershell
$env:ADMIN_EMAIL="your-admin@example.com"
$env:ADMIN_PASSWORD="a-strong-password"
npm start
```

Team registrations, city plans, and final scores are kept in `data/city-sim.json`. This is intentionally simple for a local/event deployment. For a public production deployment, use HTTPS, a database, and a real session/authentication system.
