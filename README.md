# City Resilience Simulator

A lightweight, map-style city-building challenge. Each registered team can create one city, save progress before submission, and run one final simulation. An administrator can log in separately to view rankings and event outcomes.

## Run locally

1. Install Node.js 18 or newer.
2. In this folder, run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3001`.

Do not open `public/index.html` directly or through the VS Code Live Server
extension: the interactive tools need the Node server for registration, saving,
one-run locking, and score calculations.

## Public deployment

The repository includes `render.yaml` for a Render Web Service. Connect this
repository from the Render dashboard, enter strong values for `ADMIN_EMAIL` and
`ADMIN_PASSWORD`, and deploy the Blueprint. The Blueprint mounts `/var/data`
and sets `DATA_DIR=/var/data`, so registrations and scores persist. It uses a
paid Render plan because the event store needs persistent disk storage; a free
ephemeral filesystem can lose data after a restart. After deployment, verify
the public `/health` URL before sharing the team URL.

## Demo administrator account

- Email: `admin@citysim.local`
- Password: `admin123`

Change these before a real event by setting environment variables:

```powershell
$env:ADMIN_EMAIL="your-admin@example.com"
$env:ADMIN_PASSWORD="a-strong-password"
npm start
```

## Organizer workflow (rules 2.0)

1. Open `http://localhost:3001/admin.html` and sign in.
2. Enter each approved team name under **Team registration codes** and issue one 4-digit code.
3. Give that exact team name and its four-digit code to the team. Registration consumes the code once. Existing accounts can still sign in without a new code.
4. Teams build, save, then submit once. Deleting a team does not release its used code or permit that code to be reused. Only unused codes can be revoked.
5. Review final results in the leaderboard. Submissions from the old engine retain their original results and are labeled **Legacy**; they are not ranked against rules 2.0 or included in its average.

The organizer must check real-world team identities when issuing codes. Codes stop repeat registration using one invitation; they cannot identify a person who obtains multiple approved invitations.

## Building and saving

- Budget remains ₹100 Cr. Construction tools now use lakh-scale prices: each building costs ₹1–₹5 lakh, and roads cost ₹1 lakh per 200 map metres. Internally, costs remain represented in crores for compatibility with the budget and API. Overlapping roads still cost money but add no capacity.
- Click a start and end point to draw a road. Exact crossings and T junctions connect automatically. Roads snap to existing road interiors. A road crossing the river acts as a bridge. Buildings must be on land, 34 metres apart, and within 42 metres of a road for service access.
- **Move building** selects a building, then a new position. **Remove item** refunds its cost. **Undo** works within the current editing session. **Pan map**, zoom and **Fit city** change only the view. **Floodplain** shows the risk zone used by the simulation.
- Keyboard: focus the map, use arrows to position the cursor, Enter to place, and Escape to cancel the active road or move. While drawing a road, click **Draw road** again or left-click outside the map to cancel the red dotted preview; the second click inside the map still finishes the road.
- Draft saves are serialized and stored with revisions. Failed saves preserve local edits in browser storage. Retry saving or sign in again after a session expires. Conflicting changes from another tab require an explicit choice of the server city or the local draft.
- Submit requires at least two roads, five assets and one residential area. A committed simulation locks the city. Retrying after a lost response returns the same stored result rather than running again.
- Drafts show operational coverage, demand and warnings, but no total score. Scores appear only after submission.

## Simulation rules

This is an educational engineering model, not a calibrated traffic or hydraulic forecasting tool. One map unit represents one metre. All teams face the same fixed stress conditions, with no random advantage.

- The graph splits roads at crossings, T junctions and building access points. Shortest paths determine reachability and route length. Duplicate physical edges do not add capacity.
- Each residential area adds 9,000 residents/demand units. Commercial areas add 1,500 demand, industry 4,500, hotels 1,000 and restaurants 500. Service capacity is shared across reachable demand. The **Capacity & demand** panel shows the values.
- Water and power plants each supply 24,000 units; solar adds 6,000. Drainage supplies 18,000, waste 20,000, hospital 18,000, fire 22,000, schools and buses 12,000 each. Utilities are distributed along the road network in this simplified model.
- Normal commuter demand is 40% of residents, allocated to reachable jobs. Edge loads, route distance and bus coverage influence mobility. Traffic surge doubles trips. Road segmentation cannot improve travel time or create new capacity.
- Ambulance and fire events increase service demand to 140%. They require their respective facility and a road route no longer than 1,800 m. Arrival time is modelled as two minutes dispatch plus distance at 160 m/min; local sensors reduce dispatch by half a minute. A missing hospital or fire station scores zero for its event.
- Flood exposure follows the same river geometry drawn on the map. Risk decreases to zero 100 m beyond the bank. Reachable drainage within 400 route metres and parks within 140 m reduce local damage. Flooding slows roads and water service routes. Bridges remain passable with a smaller delay.
- Waste surge raises demand to 160% of normal. Reachable collection capacity determines the outcome.
- Final score: 45% engineering plan + 55% average of five events. The engineering plan weighs access 15%, mobility 20%, emergency coverage 20%, utilities 30%, and education/jobs 15%. No points are awarded just for adding roads or saving unused budget.
- Use **Show on map** in final results to inspect event targets and response/commuter routes where available.

## Data protection and recovery

Run one Node process against a data directory. The event store remains lightweight JSON, with serialized handlers, revision checks, flushed temporary-file writes and atomic replacement. For multiple server processes, migrate to a transactional database first.

- Active data: `data/city-sim.json`.
- Previous good commit: `data/city-sim.json.bak`.
- Preserved pre-upgrade snapshot: `data/before-v2.json.bak` (created at the first write when an existing store is present).
- Code issuance, revocation, deletion and submission are recorded in a bounded audit list.
- A malformed primary store stops reads/writes with an error; it is never silently replaced with an empty database.
- Recovery: stop the server, copy the current data directory somewhere safe, inspect the backup, and restore a verified backup as `city-sim.json`. Restart and check the dashboard. Restoring an older backup also restores the registrations/submissions as of that backup; reconcile later results before reopening the event.
- Keep the data directory private; it contains password hashes, sessions and registration codes. Public hosting should use HTTPS and organizer-specific administrator credentials.

## Verification

Run `npm test`. Tests use isolated temporary stores under `work/`; they do not change event registrations or scores. Coverage includes road topology, disconnected facilities, capacity overload, segmentation/overlap fairness, flood location, validation, code reuse, competing saves/submissions, authorization and corrupted-storage protection.
