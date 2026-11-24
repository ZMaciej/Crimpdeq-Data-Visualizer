# Crimpdeq Data Visualizer

A static, GitHub Pages-ready dashboard for Crimpdeq and Tindeq Progressor force sensors. Connect over Bluetooth to chart a session and see live and peak force in kilograms.

## Use

Open the published GitHub Pages site in a browser that supports Web Bluetooth, such as Chrome or Edge on a supported desktop or Android device. Web Bluetooth requires HTTPS (or localhost); it is not supported in every browser or on iOS. Turn on the sensor, select **Connect device**, and choose it in the browser's Bluetooth picker. Unload the sensor and select **Tare**; the app averages about half a second of readings before applying the tare. Tare can be used before starting or after stopping a session; it is disabled while a session is running. Select **Start** to begin; **Restart** starts a fresh session without taring; **Stop** ends the current stream. Disconnect when finished.

On page load, the app immediately requests a Screen Wake Lock and attempts to start NoSleep.js hidden video. Browser autoplay restrictions may defer the fallback until the first touch or click. Both are paused or released when the page is hidden.

The current 5-second mean is an arithmetic average of a rolling sample vector, with its cadence inferred from device timestamps. Unfilled slots, including the history before the first reading, count as zero, so the mean is shown as soon as the session receives data. Maximum values are held for the current session. The chart's force axis starts at 0 kg; negative readings are drawn at the zero line. The chart marks the maximum measurement and shades the interval that produced the maximum 5-second mean. The chart and peak values remain visible after disconnection until a new session starts. Data stays in the browser and is not uploaded.

Measurement and peak values, as well as chart scale labels, are displayed to two decimal places.

Battery status refreshes every 10 seconds while connected. Crimpdeq firmware reports its native state of charge; standard Progressor firmware reports voltage, which is shown as an approximate percentage.

## Development and deployment

The site has no runtime dependencies or build step. Serve the repository root locally, for example with `python3 -m http.server`, and open `http://localhost:8000`. To publish, configure GitHub Pages to serve the repository root from the desired branch.

Run the session calculations and packet parsing tests with `npm test` (Node.js required). The Bluetooth protocol follows the [Tindeq Progressor API](https://tindeq.com/progressor_api/), which is also implemented by [Crimpdeq](https://github.com/crimpdeq/crimpdeq-firmware).
