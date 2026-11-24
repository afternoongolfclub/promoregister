# Tradeshow Promo Register

A tap-to-add register for handing out promo bags and add-ons at a tradeshow.

- **Register** – tap the promo bag and add-ons, then check out with a department number.
- **Report** – charge-backs by department, inventory left, every order, and an Excel download.
- **Items & stock** – set item names, starting stock and optional cost each.

Hosted on Netlify. Orders and items are stored in Netlify Blobs through `netlify/functions/api.mts`, so every device at the booth sees the same data.

## Booth PIN

All data requests need the booth PIN, stored as the `BOOTH_PIN` environment variable in Netlify (Project configuration → Environment variables). Change it there and redeploy to rotate it. If it is missing, the app stays locked.
