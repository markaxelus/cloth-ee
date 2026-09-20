# Cloth-ee

**See how influence becomes waste.** Cloth-ee is a transparent clothing-behavior simulation. Forty synthetic residents respond to price, style, trends, social connections, durability and product evidence. Their rule-based decisions create traceable purchases, wears, resale, donation and disposal events.

The core demo compares the same seeded town twice while changing one signal: whether a brand publishes a product passport. It reports the behavioral difference without presenting synthetic outcomes as predictions of real people. Read the **[pitch and 90-second demo](docs/DEMO_SCRIPT.md)** before presenting.

## Run the demo now

Install **Node.js 24 LTS**. Unzip the project and run these commands from the `cloth-ee` folder:

```bash
npm start
```

Open **http://localhost:3000/town.html** on that same computer. No package installation or API key is needed. Select residents to trace decisions, let trends develop at 10× speed, and run the controlled passport experiment in the left panel.

The residents, brands and products are fictional. Simulation events are synthetic scenario results. Environmental values appear only when their factor data is sourced; missing values remain unknown.

The repository also contains an earlier fitting-room prototype. It is not required for the core simulation demo.

The downloadable package includes the pose model and WebAssembly assets. If you are using a source-only checkout without those assets, run:

```bash
npm run setup:pose
```

Click **Camera**, grant permission and step back so your shoulders and hips are visible. Tops provide the clearest preview. When landmarks become unreliable, the tracked overlay is hidden. **Adjust alignment** changes its visual position and scale. It does not predict garment fit.

While Camera is open, use **Switch camera** to cycle between FaceTime and connected external webcams. If macOS exposes only one camera, the same control switches between mirrored selfie and normal view. Shared Unity frames preserve that orientation.

To control a running fitting room from another browser, open the same server with its session ID in the URL fragment:

```text
http://YOUR_COMPUTER_LAN_IP:3000/#session=THE_32_CHARACTER_SESSION_ID
```

Get the ID from the top-right pairing button. On a second device, `localhost` refers to that second device, not your computer. Camera and microphone access in a phone browser need HTTPS; the native Expo controller can use the local HTTP development server.

## What is implemented

| System | Included behavior | Boundary |
|---|---|---|
| Fitting room | Search, categories, previews, swipe/arrow navigation, available variant selection | Original 2D illustrations; real garments need their own overlay assets |
| Camera tracking | MediaPipe pose in the browser, confidence gating, normalized placement and mirroring | Coarse 2D alignment; no draping, occlusion or reliable size inference |
| Physical mirror | Unity transparent central space and manual overlay adjustment | Fixed stance; glasses cannot erase the clothing you are already wearing |
| Beam controller | Expo camera photo, recorded speech, swipes, sizes, favorites, alignment, evidence and checkout | Device permissions and XREAL Multi Resume need testing on your Beam |
| AR display | Unity left controls, central garment/camera view, right passport and stylist caption | XREAL SDK must be imported separately; no hardware-verified APK is supplied |
| Product passport | Composition, sourcing, manufacturing, wages, ethics, carbon boundary, source links | Live information depends on merchant metadata; unknowns remain unknown |
| OMNI | Image + raw speech + text in one request; streamed response parsing; validated suggestion | Requires an approved endpoint/model/key supporting combined inputs |
| Voice output | Browser or Expo device TTS; stop-speaking controls | TTS is device speech, not model-generated audio; push-to-talk rather than full duplex |
| Shopify | Product/variant reads, passport metafields, cart creation and hosted checkout | Requires your store and Storefront API credentials |
| Wardrobe | Save pieces, log wears, planned cost per wear and palette preference | Stored in the current session, not a permanent account |
| Shipping scenario | Editable parcel mass, distance, emission factor and same-route return | Illustrative transport calculation, not a product lifecycle assessment |
| Session service | Pairing, live browser updates, mobile/Unity polling, expiry, camera relay, deletion | In-memory sessions reset when the service restarts |

## 1. Run the Beam Pro controller

Use the tested Expo SDK 54 dependency set. This is pinned for reproducibility; it is not a claim that SDK 54 is the latest Expo release.

In a second terminal:

```bash
cd mobile
npm ci
npx expo start --lan
```

Install an **SDK 54-compatible Expo Go** on the Android device using [Expo's version selector](https://expo.dev/go). Open the project with the URL/QR shown by Expo. If your Expo Go version does not support SDK 54, use the version selector or build the native app instead of changing dependency versions at random.

To build locally with Android Studio/SDK configured and the Beam visible to ADB:

```bash
cd mobile
npx expo run:android --device
```

The included `eas.json` also defines an optional APK preview profile for an Expo EAS account:

```bash
npx eas-cli build --platform android --profile preview
```

Inside Cloth-ee Controller:

1. Enter `http://YOUR_COMPUTER_LAN_IP:3000`.
2. Paste the session ID from the browser or Unity display. Leave it blank only when creating a new session.
3. Tap Connect. Swipe across the product preview to change clothes.
4. Tap Scan tag, capture the label, then tap Talk. Speak and tap Send voice. Recording stops automatically after 15 seconds.
5. The native recording is converted to WAV on the server, so install **ffmpeg** for real voice calls. On macOS with Homebrew, run `brew install ffmpeg`.

The controller also has **Stream Beam camera to glasses**. This sends the Beam Pro camera into the Unity fitting view and supports front/rear switching. It uses manual garment alignment. For automatic body anchoring, use the browser Camera + Share flow, which runs the included MediaPipe pose model.

Only the controller/server address can be put in `mobile/.env`. Never put Shopify or OMNI credentials in `EXPO_PUBLIC_*` variables.

## 2. Run the Unity/XREAL client

The C# project is designed for Unity 2022.3 LTS. **Unity and the proprietary XREAL package are not installed in this execution environment, so the AR source has not been compiled or run on the glasses.** It must pass your device build gate before the live demo.

### Desktop preview

1. Add `unity/` as a project in Unity Hub. Use the pinned `2022.3.62f1` or a compatible 2022.3 LTS editor.
2. Open `Assets/Clothee/Resources/clothee-config.json`. For a same-computer preview, leave `http://127.0.0.1:3000`. Paste an existing session ID, or leave it blank to create one.
3. Choose **Cloth-ee → Create desktop preview scene**. Save the scene, start the Node server, then press Play.
4. Use the browser or Expo controller to change products. Desktop arrow keys are available when Unity's legacy input system is enabled.

### Actual XREAL One and Beam Pro

First get the official **HelloMR** sample running with your actual hardware, following [XREAL's setup guide](https://docs.xreal.com/Getting%20Started%20with%20XREAL%20SDK). Import the XREAL SDK tarball and its Interaction Basics sample, configure XR Plug-in Management and run Project Validation. Use a MyGlasses/SDK combination listed in the [compatibility documentation](https://docs.xreal.com/XREALDevices/Compatibility).

Then:

1. Work in the configured XREAL project. Copy `unity/Assets/Clothee` into its `Assets` folder. Keep the SDK's camera rig and EventSystem; remove the sample demonstration objects.
2. Use the complete **XR Interaction Setup** prefab from XREAL's Interaction Basics sample. It supplies the XR Origin, Beam Pro controller interaction, EventSystem and input actions. Tag its rig camera `MainCamera`, or assign it to the generated Cloth-ee component.
3. Choose **Cloth-ee → Add app to current XREAL scene**. Set `serverUrl` to the computer's reachable LAN address. Set `sessionId` to the shared fitting-room ID. Neither field is an API key.
4. Choose **Cloth-ee → Configure LAN prototype Android settings**. This sets the app identifier, IL2CPP/ARM64 and local cleartext access. Run XREAL Project Validation afterward.
5. For the base One, select its **Vision** device category and **3DoF** tracking. Set **Initial Input Source** to **Controller**. Enable **Support Multi Resume** to try the Expo controller on the Beam while the AR app remains displayed. Use the matching SDK's Android build settings, save the scene and build/install the APK.
6. Open through MyGlasses, grant the requested display permissions, and launch the controller. Verify that swiping changes the Unity item before adding more features.

The Beam touchpad changes garments with horizontal swipes and menu focus with vertical swipes. Pointing the Beam aims the XREAL ray; tapping activates a button. App shows or hides the passport, and Home retains XREAL's recenter behavior. The SDK's [phone controller](https://docs.xreal.com/Input%20and%20Interactions/Controller) also supports a customized `XREALVirtualController`. Exact setup and callback names are in [XREAL controls and camera](docs/XREAL_CONTROLS_AND_CAMERA.md). If Multi Resume causes problems, use Expo on another phone or the laptop browser.

### Physical mirror demonstration

Stand on a floor mark, face the mirror, press Recenter in Unity, and select Mirror mode in the controller. Use its arrows and scale buttons to align the garment. Keep the same position; recalibrate after moving. The base One tracks rotation, not full positional movement. It has no built-in RGB camera unless its separate accessory is attached. The One series also does not provide SDK hand tracking. [XREAL hardware reference](https://docs.xreal.com/XREALDevices/XREAL%20Glasses)

An optical overlay cannot remove your real clothes or render opaque black over the mirror. A pale garment over a dark plain shirt is easier to demonstrate than a dark garment over a patterned shirt. This is an additive illustration, not photorealistic virtual try-on.

### Camera fitting demonstration in glasses

On the paired computer, enable Camera and check **Share camera view with paired Unity display**. Choose Live fitting view on the controller. Unity displays the camera frame with the garment aligned to its capture-time pose data. The prototype relay targets about five frames per second and preserves the last good frame through a short network gap. The browser's own camera overlay remains smoother. Stop camera or uncheck sharing to remove the relay. Images are held in memory and expire after six seconds.

## 3. Connect Shopify

Copy `.env.example` to `.env` and fill in your actual values:

```dotenv
CATALOG_MODE=shopify
SHOPIFY_STORE_DOMAIN=your-store.myshopify.com
SHOPIFY_STOREFRONT_TOKEN=your_storefront_token
SHOPIFY_TOKEN_KIND=public
SHOPIFY_API_VERSION=2026-07
```

Use a Storefront token, not an Admin API token. For a private Storefront token, set `SHOPIFY_TOKEN_KIND=private`; the service uses the corresponding private-token header. Publish products to the relevant sales channel and grant the product/cart capabilities required by your store configuration. A public Storefront token is still kept server-side here for one consistent configuration path.

Restart the server. Live catalog failures are reported; they do not silently switch to fictional products. Up to 250 products and 100 variants per product are loaded for this prototype. An indicator reports product truncation; `variantsTruncated` reports per-product variant truncation in the catalog response.

Configure these product metafields with Storefront read access:

| Namespace/key | Type | Purpose |
|---|---|---|
| `clothee.category` | Single-line text | `shirt`, `pants`, `hat`, `glasses`, `scarf` or `shoes` |
| `clothee.overlay_url` | URL | HTTPS transparent PNG URL, centred and tightly cropped |
| `clothee.passport` | JSON | Product composition and evidence, using the schema below |

Use the included [passport example](docs/passport.example.json). Every specific sourcing, manufacturing, wage or ethics claim requires a source URL before it is shown. The app labels accepted merchant-entered claims **brand-reported**. It never converts a merchant's `verified` flag into independent verification. Carbon data requires a value, boundary and source URL.

The prototype uses a product-level overlay. If variants have different colours, supply separate products/assets for the demo or add variant-specific assets before claiming colour-accurate previews. Size changes select the correct purchasable variant; they do not rescale a garment as a measured fit simulation.

Product photography, AR overlay assets and manufacturing evidence are different things. A normal product image is used for the clothing rail; no overlay is shown when the transparent asset is missing. Do not upload a white-background product photo and call it a transparent garment.

The Shop button creates a Shopify cart for the **currently selected available variant** and opens Shopify's checkout URL. It never places an order itself. Review your store's [metafield access setup](https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/metafields) and [cartCreate API](https://shopify.dev/docs/api/storefront/latest/mutations/cartCreate).

## 4. Connect Huawei's OMNI challenge

The sponsor's [official challenge repository](https://github.com/cari-waterloo-rc/OMNI-Live-Build-the-Next-Generation-of-Real-Time-Multimodal-AI) links its API-credit application and directs teams to yibuapi. It does not publish a complete model/endpoint contract. Get the full Chat Completions URL, approved model name and key from your issued account or sponsor mentor.

```dotenv
OMNI_MODE=live
OMNI_CHAT_URL=https://YOUR_APPROVED_HOST/v1/chat/completions
OMNI_MODEL=YOUR_APPROVED_COMBINED_INPUT_MODEL
OMNI_API_KEY=your_secret_key
OMNI_COMBINED_INPUT=true
```

This adapter uses OpenAI-compatible **Qwen Omni Chat Completions**, sending `text`, `image_url` and `input_audio` in one user message and parsing SSE response chunks. It requests structured text output and uses device TTS for spoken playback. The compatibility flag is an explicit operator assertion, not automatic model detection. Confirm combined image/audio support before enabling it. Some older Omni models accept only one non-text modality at a time. [Qwen Omni protocol reference](https://www.alibabacloud.com/help/en/model-studio/qwen-omni)

Test the actual account with a JPEG label image and a WAV recording of a question:

```bash
OMNI_TEST_IMAGE=/absolute/path/label.jpg \
OMNI_TEST_AUDIO=/absolute/path/question.wav \
npm run check:live
```

This command makes a real model call and consumes your API allowance. It prints the answer and modality status, never your key. Verify that the answer responds to both the visible tag and the spoken request. The client displays a suggestion separately; the user taps Try suggestion to apply it. Unknown or invented product IDs are rejected.

For the sponsor demo, offline rules, plain browser dictation and a vision-only model do not establish meaningful OMNI audio use. This app sends the recorded audio itself to the configured model. Photo + spoken question + catalog reasoning form the complete three-modality scenario.

## Privacy, session lifetime and deployment boundary

Camera frames stay in the browser unless the user enables sharing or submits a current-frame styling question. The native controller submits only an explicitly captured photo. Audio is recorded after a user action and sent on submission; native temporary recording files are deleted after reading. The server keeps media in memory and does not write recordings to disk. The external model provider's retention policy is separate and depends on your account.

Session IDs are random capabilities: anyone with the full ID can control/read that fitting room. Sessions expire after two hours without API activity, or immediately after Clear/Delete session. Closing a tab alone does not revoke a session. Profiles, wardrobe selections and text answers exist only in that session. Pair only your own devices on the demo network. For public deployment, add account authentication, durable storage, HTTPS, request accounting and your provider retention disclosure; this package is configured for a local hackathon demonstration.

## Tests and project map

```bash
npm test
cd mobile
npm run typecheck
npm run check
npx expo export --platform android --output-dir ../artifacts/mobile-bundle
```

`docs/VALIDATION.md` records the checks actually run and the hardware/API checks still outstanding. Optional browser verification lives in `scripts/browser-check.mjs` and needs Playwright plus a Chromium browser.

| Path | Contents |
|---|---|
| `server/` | HTTP/session service, Shopify adapter, OMNI adapter |
| `shared/` | Domain logic and fictional catalog |
| `public/` | Complete browser fitting room, artwork, local pose assets |
| `mobile/` | Expo controller, pinned dependency lock, Android configuration |
| `unity/Assets/Clothee/` | Unity client, DTOs, setup menus and phone-button bridge |
| `tests/` | Core state, API integration and adapter tests |
| `docs/` | Game plan, setup data example, demo script and validation report |

## Troubleshooting

| Symptom | First check |
|---|---|
| Controller cannot connect | Use the server's LAN IP, allow local incoming port 3000, and avoid isolated venue Wi-Fi |
| Browser camera/mic missing on a phone | Use HTTPS or the native Expo app; ordinary LAN HTTP is not a secure browser context |
| Camera stays in manual mode | Ensure `public/vendor/` contains the model/WASM assets; run `npm run setup:pose` and reload |
| Garment vanishes in camera mode | Get the relevant body landmarks into view; missing/low-confidence landmarks intentionally hide it |
| Native voice cannot decode | Install ffmpeg and ensure the server can execute it; set `FFMPEG_PATH` if necessary |
| OMNI returns 401/403/404 | Confirm the sponsor's exact endpoint, model ID, key and credit access |
| OMNI rejects combined inputs | Ask for a model supporting image and audio in the same request; do not assume every Omni version does |
| Shopify metadata is absent | Check namespace/key, Storefront access and source URLs; missing evidence stays unknown |
| Unity has blank clothing | Use an HTTPS transparent PNG, check the LAN URL, and inspect the Unity status line |
| Unity app will not open in MyGlasses | Confirm official HelloMR works first, then check SDK/device categories and Project Validation |
| Mirror overlay drifts when moving | Recenter and return to the calibration position; free-moving mirror registration is outside this prototype |
