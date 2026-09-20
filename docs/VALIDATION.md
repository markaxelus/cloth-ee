# Validation record

Completed 20 September 2026. This record separates software checks performed here from checks requiring your devices and accounts.

## Passed

| Check | Result |
|---|---|
| Node backend/domain/adapter suite | 18 tests passed, 0 failed |
| State changes | Selection, sizes, favorites and independent sessions verified |
| Concurrency | A delayed model answer does not undo a newer product selection |
| Shopify adapter | Exact variant cart request and upstream errors tested with mocked HTTP responses |
| OMNI adapter | Image + raw audio + text request shape, fragmented SSE parsing, invalid IDs and explicit mode gates tested with mocked HTTP responses |
| Evidence handling | Unsourced claims remain unknown; supplied merchant claims are not labelled independently verified |
| Media relay | Image expiry and capture-time pose matching verified |
| Browser interface | Desktop at 1440 px and phone layout at 390 px exercised without horizontal overflow or page exceptions |
| Browser user flow | Navigation, paired tabs, favorites, logged wears, profile, evidence tabs, cost per wear, shipping scenario, demo stylist and demo checkout handoff verified |
| Body tracking | Real MediaPipe model executed against the official person image supplied as a simulated camera stream; the shirt overlay followed the detected torso |
| Camera relay | Opt-in sharing produced a JPEG with the matching 33-landmark pose header |
| Browser voice | Microphone capture and WAV submission exercised with a simulated audio device; offline mode correctly disclosed that media was not analyzed |
| Expo TypeScript | `npm run typecheck` passed |
| Expo dependency validation | `expo install --check` reported dependencies up to date for the pinned SDK |
| Expo Android JS export | Metro bundled 618 modules and produced a Hermes Android bundle successfully |

The browser camera check used a static person fixture, not a moving human wearing the glasses. It validates model execution, coordinate alignment and rendering, not tracking quality under all real-world poses. The script uses browser automation's fake camera/microphone devices so no real user media was captured.

## Not verified here

- Unity C# compilation and Android APK build. Unity and the XREAL SDK were not available in this environment.
- Actual XREAL One / Beam Pro display, tracking latency, controls, permissions and Multi Resume behavior.
- A live sponsor OMNI account, its exact model identifier, combined-modality support, output formatting and response time.
- Live Shopify product/metadata access, real inventory changes and checkout contents with your store credentials.
- Native Expo camera/microphone behavior on your physical Beam Pro.
- Free-moving optical mirror registration, photorealistic cloth drape, occlusion or measured size prediction. These are not implemented features.

An Android JavaScript bundle is not an APK. Passing an adapter test with mocked responses is not evidence of a successful live provider call. Use the README's device and live API gates before presenting those integrations as operational.

## Reproduce

```bash
npm test
cd mobile
npm ci
npm run typecheck
npm run check
npx expo export --platform android --output-dir ../artifacts/mobile-bundle
```

For the browser check, install Playwright and its Chromium browser locally, then run `node scripts/browser-check.mjs`. The script starts its own temporary server. `CLOTHEE_VIDEO_FIXTURE=/absolute/path/person.y4m` optionally supplies a person video for asserting actual pose detection; without it the fake camera normally has no person and the expected result is hidden tracking.

For live APIs use `npm run check:live` with the configuration and media paths described in README. For hardware, run official HelloMR first, then the Cloth-ee scene on the same verified SDK/runtime combination.
