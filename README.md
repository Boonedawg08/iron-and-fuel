# Iron & Fuel

A workout and nutrition tracker that installs to your phone's home screen and works with no
connection. Everything is stored on the phone itself: no account, no server.

- **LIFT**: routines, a live workout screen with a big checkbox per set, per-set weight and reps
  with quick +5 / −5 buttons, what you did last time, a rest timer, history, progress charts and
  personal records. Pounds or kilograms.
- **FUEL**: calorie and macro targets from your stats and goal, a food database of 8,000 USDA
  foods built in, meal logging by typing what you ate, a daily dashboard, a weekly view and a
  body-weight log.

## Put it on your phone

### Step 1: publish the site (pick one)

**GitHub Pages** (the built app is already in this repo's `gh-pages` branch)

1. Open the repo on GitHub, then **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Set **Branch** to `gh-pages` and the folder to `/ (root)`, then press **Save**.
4. Wait about a minute and reload the page. The address appears at the top, in the form
   `https://<your-username>.github.io/iron-and-fuel/`.

From then on, every change pushed to `main` is tested, rebuilt and published automatically
(see the **Actions** tab).

**Netlify**

1. Go to <https://app.netlify.com> and sign up or log in with GitHub.
2. Choose **Add new site** → **Import an existing project** → **GitHub**, and pick this repo.
3. Leave the build settings as they are (they come from `netlify.toml`) and press **Deploy**.
4. After a minute you get an address like `https://something.netlify.app`. You can rename it
   under **Site configuration** → **Change site name**.

Use one address and stick with it: each address keeps its own separate data on your phone.

### Step 2: add it to your home screen

**iPhone**

1. Open the address in **Safari**.
2. Tap the **Share** button (the square with an arrow), scroll down, tap **Add to Home Screen**,
   then **Add**.
3. Open Iron & Fuel from the new home-screen icon and leave it open for a few seconds while
   online, so it can save itself for offline use.

**Android**

1. Open the address in **Chrome**.
2. Tap the **⋮** menu, then **Install app** (or **Add to Home screen**), then **Install**.
3. Open it once while online.

### Step 3: check it works offline

Turn on airplane mode and open the app from the home screen. Everything should work, including
food search and meal logging. Only the "search online for branded foods" button needs a
connection.

Install first, then enter your data. On iPhone the home-screen app keeps its data separately
from the Safari tab, so anything you typed in Safari will not follow you into the installed app.

## Keep your data safe

Your data exists only on your phone. Removing the app from the home screen, or clearing website
data, deletes it.

- **Settings → Export backup** saves everything to one JSON file. Do it now and then and keep
  the file somewhere safe (Files, iCloud Drive, or email it to yourself).
- **Settings → Import backup** restores a file. It replaces what is on the phone.
- Moving to a new phone or a different address is an export on the old one and an import on the
  new one.

## Using it

**Logging a meal by typing.** Write what you ate, for example
`5oz chicken breast with 100 grams of white rice and a tablespoon of olive oil`, and press
**Find foods**. Each item becomes a card showing the matched food, grams, calories and macros.
You can change the grams or swap the match before saving.

The app understands oz, lb, g, kg, cups, tbsp, tsp, ml, litres, fl oz, "a / an", fractions
(`1/2`, `1 1/2`, `½`), counts (`2 eggs`), sizes (`1 large banana`), and household measures such
as slice, can, scoop, handful, glass and bowl.

A card is outlined in yellow, and must be ticked before the meal can be saved, when:

- the match is uncertain (a word was not found, a typo was guessed, or the best match is one
  variety among several), or
- the amount is a guess (no amount was typed, or the food has no weight for that measure).

Meat, grains and beans are assumed cooked and fruit and vegetables raw unless you say otherwise,
and the card says so.

**Branded and packaged foods.** In the **Search** tab, **Search online for branded foods** asks
USDA FoodData Central and Open Food Facts. You can also type a barcode number. Anything you log
is kept on the phone for offline use. USDA's shared demo key allows only a few searches an hour;
a free personal key (**Settings → Get a free USDA API key**) removes that limit.

**Calorie targets.** FUEL → **Goals** → **How this was calculated** shows every step: resting
calories from the Mifflin-St Jeor equation, an activity multiplier, a goal adjustment capped at
500 kcal either way, protein by body weight, fat at 27.5% of calories and carbs as the rest. You
can override any target; very low targets show a warning. These are estimates, not medical
advice.

## Good to know

- The rest timer keeps the right time if you lock the phone, but a web app cannot sound an alarm
  while the phone is locked or the app is in the background. With the app open it beeps (and
  vibrates on Android).
- "Keep screen on" during a workout depends on the phone supporting it.
- There is no sync between devices.

## For developers

```bash
npm install
```

```bash
npm run dev
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm test` | Unit tests (meal parser, unit conversions, goal calculator, food matching, lifting stats, backup) |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run build:foods` | Re-download the USDA datasets and rebuild `public/data/foods.json` |
| `npm run build:icons` | Re-render the PNG icons from `public/icons/icon.svg` (needs Playwright) |

Stack: Vite, React, TypeScript, Tailwind CSS, Dexie (IndexedDB), vite-plugin-pwa.

| Path | Contents |
|---|---|
| `src/lib/parser.ts` | Meal text → quantity, unit, food |
| `src/lib/foodSearch.ts` | Offline search, match confidence, amount → grams |
| `src/lib/aliases.ts` | Everyday names → the USDA entry most people mean |
| `src/lib/goals.ts` | Calorie and macro calculator |
| `src/lib/lift.ts` | Workout lifecycle, progress and personal records |
| `src/lib/online.ts` | USDA and Open Food Facts lookups |
| `src/db.ts` | Data model and IndexedDB schema |
| `scripts/build-food-db.mjs` | Builds the bundled food database |

The build uses relative paths and hash routing, so the same `dist/` folder works at a domain
root (Netlify) and under a sub-path (GitHub Pages).

## Data sources

- Bundled foods: [USDA FoodData Central](https://fdc.nal.usda.gov/), Foundation Foods and
  SR Legacy datasets. Public domain.
- Online results: USDA FoodData Central API and [Open Food Facts](https://world.openfoodfacts.org/)
  (Open Database License).
