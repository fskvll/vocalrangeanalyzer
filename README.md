# Vocal Range Analyzer

Sing into your microphone and find out your vocal range and voice type — soprano, mezzo-soprano, alto, tenor, baritone, or bass.

## How it works

1. Click **Start** and allow microphone access
2. Sing your lowest comfortable note and hold it
3. Sing your highest comfortable note and hold it
4. Sing freely for a few seconds
5. Get your result with a diagram showing where your range sits compared to all voice types

Pitch detection runs entirely in the browser using the Web Audio API. No data is sent anywhere.

## Run it locally

You need a local server because browsers block microphone access on `file://` URLs.

```sh
python3 -m http.server 5500
```

Then open `http://localhost:5500` in Chrome or Firefox.

## Built with

- Web Audio API (pitch detection via autocorrelation)
- HTML / CSS / JavaScript
- Canvas API (range diagram)
