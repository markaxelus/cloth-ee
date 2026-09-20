# Cloth-ee: wear the story

A bubbly AR fitting room that connects how an item looks with what is actually known about it. The first complete loop is: scan a label, ask a spoken question, see a suggested Shopify item, preview it, examine its evidence, and open its selected variant in checkout.

## The hardware decision

Use Unity for the XREAL display, Expo for the Beam Pro controller, and a Node service for sessions, product data and cloud AI. XREAL SDK 3.1 uses Unity XR infrastructure. The base One has 3DoF and no attached RGB camera by default. Its optional camera is separate; do not assume hand tracking, plane detection, depth meshing or spatial anchors. Use the Beam rear camera for label images. Enable XREAL Support Multi Resume to try Expo on the Beam while Unity continues in the glasses. Test this first on the actual MyGlasses/SDK combination; a second phone or laptop controller is the fallback.

Do not promise a photorealistic optical mirror replacement. Optical see-through glasses add light, so they cannot erase a real shirt. A phone camera's pixels also do not directly map to the wearer's mirror view. The project therefore includes a manual, fixed-stance mirror preview and an automatic, camera-based 2D fitting view. Neither is a garment fit measurement or cloth simulation.

## The screen

Left: a narrow clothing rail, categories, product cards and favorites. Centre: the person/mannequin and current overlay, plus next/previous, alignment and camera controls. Right: price/variant, material information, sourcing, manufacturing, wages, evidence links, and cost per wear. Bottom: a small stylist bubble with text, capture and voice controls. Cream, lilac, peach and mint, rounded corners, large touch targets and readable dark text. Unity uses smaller high-contrast panels and a black background for optical transparency.

## Build order and gates

| Time box | Deliverable | Pass condition |
|---|---|---|
| 0–2 hours | Hardware and cloud smoke tests | HelloMR displays on the actual One; sponsor accepts image + audio + text; Shopify returns one product |
| 2–6 hours | Shared catalog and controller | Swipe changes the same item on controller and display; selected size is visible |
| 6–12 hours | Fitting view | Transparent top follows shoulders/hips in a webcam view; missing landmarks hide the automatic overlay |
| 12–18 hours | OMNI + tag scan | Actual image and recorded voice reach the approved model; answer explains evidence and suggests a catalog ID |
| 18–24 hours | Shopify and passport | Live variants, material metadata, a provenance link, and checkout URL work |
| 24–30 hours | Device integration | Unity mirror alignment, touch controller and reconnect work on venue Wi-Fi |
| 30–36 hours | Rehearse | Complete the 90-second flow twice; rehearse the labelled offline fallback |

These are planning estimates, not claims about elapsed work. Start the hardware and sponsor gates immediately; they are the critical path.

## Systems

1. Session service: unguessable pairing IDs, revisions, live state updates, input validation, idle expiry and explicit session deletion.
2. Catalog: a clearly labelled fictional collection for offline demonstrations, or Shopify Storefront products/variants. Missing product passport fields stay unknown.
3. Tracking: local MediaPipe pose landmarks in the browser, confidence gating, single camera-to-view transform and adjustable garment placement. The Expo controller captures photos; it does not contain a native MediaPipe pipeline.
4. AR client: Unity world-space clothing rail and passport; camera-fitting display from a paired browser; fixed-stance mirror overlay with calibration. XREAL's actual tracking rig supplies head rotation.
5. Assistant: image + raw recorded voice + selected-product context in the same OMNI request. The service parses streaming output into an answer and validated product recommendation. Clients use device TTS for playback. This is push-to-talk, not full-duplex realtime speech.
6. Evidence: material composition, sourcing and manufacturing locations, wage disclosures, carbon boundary, method/date/source. A tag can reveal printed text; it cannot prove wages or lifecycle emissions.
7. Commerce: select an available variant, create a Shopify cart, open its hosted checkout. No purchase is made automatically.
8. Profile and wardrobe: height, usual sizes, preferred palette, saved items, wear count and cost per planned wear. Height alone never estimates body size.

## Mirror overlay: how it works

The software, rather than OMNI, positions clothing. In a camera view, MediaPipe supplies shoulders/hips/head/feet; the renderer scales a transparent garment asset to the relevant landmarks. The same video rectangle and mirroring transform apply to the garment. No landmarks means no automatic overlay. Tops are the strongest demo; pants and accessories are coarse 2D previews with no occlusion or independent shoe tracking.

For the physical mirror, manually position and size the garment while standing on a floor mark. The Unity panel is recentered at eye level. Remain at that position and recalibrate after moving. True free-moving mirror alignment needs a calibrated head-to-camera relationship, mirror plane, positional tracking, and suitable occlusion/garment modelling. Those are future work, not solved by an LLM recognizing a body.

## Prize demonstration

Hold up a clothing label and say: “I like this colour, but need something breathable for a warm day. What do we actually know about how it was made?” The model uses the image to read visible details, the audio to understand the question, and catalog evidence to explain a recommendation. Apply the recommended Shopify item, show the manufacturer evidence and an honest missing wage field, then open the selected variant in checkout. The model recommendation only applies when the user taps Try suggestion.

The Huawei track must be demonstrated with the real approved OMNI endpoint; the offline stylist does not qualify. The Shopify track should use actual store products and cart creation. A sample catalog is for rehearsal.

## Distinctive additions included

**Evidence lens:** missing data is visible rather than turned into a green score. **Wear it again:** save pieces and log wears. **Cost per wear:** compare purchase cost at a chosen use count. **Palette mood:** user-chosen palettes suggest combinations without inferring ethnicity or appearance. **Honest fit:** labels distinguish illustrative overlays from a reliable size prediction.

## Source checks (19 September 2026)

- XREAL hardware: https://docs.xreal.com/XREALDevices/XREAL%20Glasses
- XREAL feature matrix: https://docs.xreal.com/XREALDevices/Compatibility
- Unity setup / Multi Resume: https://docs.xreal.com/Getting%20Started%20with%20XREAL%20SDK
- Huawei sponsor challenge and credit application: https://github.com/cari-waterloo-rc/OMNI-Live-Build-the-Next-Generation-of-Real-Time-Multimodal-AI
- Qwen Omni combined inputs and streaming protocol: https://www.alibabacloud.com/help/en/model-studio/qwen-omni
- Pose Landmarker: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
- Shopify metafields: https://shopify.dev/docs/storefronts/headless/building-with-the-storefront-api/products-collections/metafields
- Shopify cartCreate: https://shopify.dev/docs/api/storefront/latest/mutations/cartCreate

The sponsor repository directs teams to yibuapi for credits; it does not publish a complete endpoint/model contract. The adapter's exact URL, model ID and combined-input support must be verified with your issued account.
