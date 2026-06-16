# Vocal Range Analyzer

Sing into your microphone and find out your vocal range and voice type — soprano, mezzo-soprano, alto, tenor, baritone, or bass.

## How it works

1. Click **Start** and allow microphone access
2. Sing your lowest comfortable note and hold it
3. Sing your highest comfortable note and hold it
4. Sing freely for a few seconds
5. Get your result with a diagram showing where your range sits compared to all voice types

Pitch detection runs entirely in the browser using the Web Audio API. No data is sent anywhere.

## Run it

**Option 1 — Local server**

Browsers block microphone access on `file://` URLs, so you need a local server:

```sh
python3 -m http.server 5500
```

Then open `http://localhost:5500` in Chrome or Firefox.

**Option 2 — GitHub Pages**

Fork the repo and enable GitHub Pages under Settings → Pages → Deploy from branch (main). Your site will be live at `https://yourusername.github.io/vocalrangeanalyzer` with microphone access working out of the box.

## Built with

- Web Audio API (pitch detection via autocorrelation)
- HTML / CSS / JavaScript
- Canvas API (range diagram)
