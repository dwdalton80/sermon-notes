# Even Hub Demo

A starter app for **Even Realities G2** smart glasses, built with the
[Even Hub SDK](https://hub.evenrealities.com/docs/get-started/overview).

An Even app is just a web app (HTML/CSS/TS) that runs inside the Even App
WebView on your phone. The phone does the work; the glasses are the display.
The `@evenrealities/even_hub_sdk` bridge is how your code talks to the glasses.

## What this demo does

- Waits for the Even App bridge, then reads user + device info
- Creates a start-up page container on the glasses with one text container
- Registers a first-level contextual menu ("Say hello" / "Say bye") that
  updates the on-glasses text via `textContainerUpgrade`
- Logs launch source, device status, menu clicks, and long-press events
- Falls back to a plain status panel when opened in a normal browser tab
  (no bridge), so you can still iterate on layout

Source: [`src/main.ts`](src/main.ts). Manifest: [`app.json`](app.json).

## Prerequisites

- Node.js 20 LTS or 22+ (`node --version`)
- Even Realities account + Developer Mode enabled at https://hub.evenrealities.com
- For on-glasses testing: G2 glasses woken from shipping mode and paired,
  Even App `2.2.9`+
- Global tooling (already installed on this machine):

  ```bash
  npm install -g @evenrealities/evenhub-cli @evenrealities/evenhub-simulator
  ```

## Develop

```bash
npm install        # first time only
npm run dev         # Vite dev server on http://localhost:5173 (LAN-exposed)
```

Then, in a second terminal, pick one:

**Simulator** (no hardware needed):

```bash
npm run sim        # evenhub-simulator http://localhost:5173
```

**Real glasses** via QR sideload (Developer Mode must be on):

```bash
# print your LAN IP
ipconfig getifaddr en0

# generate a QR pointing at the dev server
evenhub qr --url "http://<YOUR-LAN-IP>:5173"
```

In the Even App tap **Scan QR** and aim at the terminal. Hot reload works.

## Package & submit

```bash
npm run pack       # builds dist/, then: evenhub pack app.json dist -o even-hub-demo.ehpk
```

Upload the `.ehpk` at https://hub.evenrealities.com following the App
Submission & QA guidelines. Bump `version` in `app.json` for each build.

## Manifest notes (`app.json`)

| Field             | Meaning                                                        |
| ----------------- | ------------------------------------------------------------- |
| `package_id`      | Reverse-DNS unique id. Change before real submission.         |
| `edition`         | Platform edition target (`202601`).                          |
| `min_sdk_version` | Must match the installed `@evenrealities/even_hub_sdk`.       |
| `min_app_version` | Even App floor; SDK 0.0.14 requires `2.2.9`.                  |
| `permissions`     | Empty here. Add `network` / `location` entries as needed.     |

## Hardware constraints to design around

- Display: 576 × 288 px per eye, monochrome green, 16 brightness levels
- No camera or speaker on the glasses; 4-mic array in, 16 kHz PCM
- Input: temple touchpads + optional R1 ring (tap / swipe / long-press)
- Transport: BLE 5.2 — keep payloads small; images are LZ4-compressed by the SDK
- `containerTotalNum` 1–12; max 8 text containers; exactly one container
  should set `isEventCapture: 1`

## Docs

- Overview: https://hub.evenrealities.com/docs/get-started/overview
- Quickstart: https://hub.evenrealities.com/docs/get-started/quickstart
- SDK API map: `node_modules/@evenrealities/even_hub_sdk/README.md`
- Templates: https://github.com/even-realities/evenhub-templates
