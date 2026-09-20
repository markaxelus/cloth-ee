# Cloth-ee

**See how influence becomes waste.**

Cloth-ee is a transparent clothing behavior simulation. Forty synthetic residents respond to price, style, trends, social connections, durability, and product evidence. Their rule-based decisions create traceable purchases, wears, resale, donation, and disposal events.

- **Live demo:** https://cloth-ee.vercel.app
- **Pitch and demo script:** [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md)

## Why Cloth-ee exists

Clothing waste does not always begin at the bin. It can begin when a post, trend, or low price causes someone to replace a garment that still has useful life remaining.

Cloth-ee makes that chain visible:

```text
social signal -> purchase -> displaced garment -> unused wears -> disposal
```

The project is a scenario lab, not a prediction engine. Its residents and products are synthetic. Results describe what happened under the model's assumptions, not what a real person will do.

## Run locally

Install Node.js 24 LTS, then run:

```bash
npm start
```

Open http://localhost:3000/town.html.

No API key is required for the core simulation. Select residents to inspect their decisions, run the town at 10x speed, or compare two 14-day scenarios from the experiment panel.

## What the simulation models

Each resident has a:

- Persona and daily role
- Budget and income
- Style preference
- Social network
- Favorite brand
- Sensitivity to trends and price
- Interest in product evidence
- Garment retention and disposal behavior

Residents move through a seeded town, interact, publish posts, develop brand awareness, visit shops, and make purchases. Garments accumulate wears before being resold, donated, or binned.

The purchase score is:

$$
U(r,g)=w_sS(r,g)+w_eE(g)-w_pP(r,g)+N(r,g)+T(r,g)+0.15A(r,g)-0.55
$$

Where:

- \(S\) is style compatibility
- \(E\) is product-passport completeness
- \(P\) is price pressure relative to budget
- \(N\) is clothing need
- \(T\) is trend influence
- \(A\) is social awareness
- \(w_s\), \(w_e\), and \(w_p\) are persona-specific weights

The resident buys the available garment with the highest positive score. The same seed and settings reproduce the same outcome.

## Controlled experiments

The main experiment runs the same town twice:

1. Run a baseline for 14 simulated days.
2. Rebuild the town with the same seed.
3. Publish one brand's clothing passport.
4. Run the same 14 days again.
5. Compare purchases, binning, and trend-linked waste.

Using the same seed isolates the changed signal from unrelated randomness. Cloth-ee reports mixed or negative outcomes instead of forcing every intervention to appear successful.

## Product passports and impact data

Garments can disclose materials, mass, origin, factory, wages, carbon, water, waste, and end-of-life information.

Environmental impact is calculated only when every material has a sourced factor:

$$
\text{Impact}=m\sum_{i=1}^{n}s_i f_i
$$

Here, \(m\) is garment mass, \(s_i\) is a material share, and \(f_i\) is its impact factor. If any required factor is missing, the result remains unknown. Cloth-ee does not display misleading partial totals.

## Multimodal AI

The server includes an OpenAI-compatible Qwen Omni adapter. It accepts a rendered outfit image with optional audio and text, then returns validated garment observations and a grounded conversational answer.

AI is used for perception and conversation. It does not control resident behavior, generate lifecycle statistics, or receive hidden outfit ground truth.

To enable a compatible live endpoint:

```dotenv
OMNI_MODE=live
OMNI_CHAT_URL=https://YOUR_HOST/v1/chat/completions
OMNI_MODEL=YOUR_MODEL
OMNI_API_KEY=YOUR_KEY
OMNI_COMBINED_INPUT=true
```

The public deployment currently runs the guaranteed demo path without live OMNI credentials.

## Shopify

The Shopify Storefront adapter supports:

- Product and variant loading
- Prices and availability
- Product-passport metafields
- Transparent garment asset metadata
- Cart creation for the selected variant
- Shopify hosted checkout

Configure it with:

```dotenv
CATALOG_MODE=shopify
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=your_storefront_token
SHOPIFY_TOKEN_KIND=public
SHOPIFY_API_VERSION=2026-07
```

The town currently uses a fictional seeded catalog. Shopify is implemented in the service layer but is not part of the main town interface.

## Architecture

```text
Browser Canvas UI
  |-- shared deterministic simulation
  |-- resident and event inspection
  |-- baseline comparison
  |
Node HTTP service
  |-- town simulation API
  |-- multimodal AI adapter
  |-- Shopify Storefront adapter
  |-- session and catalog APIs
```

Important paths:

- `shared/town/simulation.mjs`: simulation clock and lifecycle
- `shared/town/residents.mjs`: resident generation and purchase utility
- `shared/town/interactions.mjs`: social behavior and disposal
- `shared/town/data.mjs`: products, factors, and validation
- `public/js/town/render.mjs`: Canvas renderer
- `public/js/town/ui.mjs`: controls and causal stories
- `server/town.mjs`: town API
- `server/omni.mjs`: multimodal AI adapter
- `server/catalog.mjs`: Shopify adapter
- `api/index.js`: Vercel function entry point

## API highlights

- `GET /api/town`: seeded town data
- `GET /api/town/catalog`: garments and passport completeness
- `POST /api/town/simulate`: headless scenario run
- `POST /api/town/scan`: multimodal garment inspection
- `GET /api/health`: configured capabilities

## Tests

```bash
npm test
```

The automated suite covers:

- Deterministic scenario replay
- Baseline and intervention isolation
- Product evidence validation
- Material impact boundaries
- Multimodal input handling
- Garment matching
- Shopify cart creation
- Session isolation and concurrency

## Limitations

- Personas are synthetic and not calibrated against real consumers.
- Scenario results are not forecasts.
- Environmental factors remain unknown until sourced.
- Sessions use in-memory storage.
- Live AI and Shopify require external credentials.
- Real-world causal claims require controlled validation.

## Deployment

The repository includes `vercel.json` and a Node function entry point:

```bash
vercel --prod
```

The root URL redirects to the town experience.

## License

See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
