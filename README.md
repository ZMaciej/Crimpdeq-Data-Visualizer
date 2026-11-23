# Crimpdeq Data Visualizer

A static, GitHub Pages-ready dashboard for Crimpdeq and Tindeq Progressor force sensors. Connect over Bluetooth to chart a session and see live and peak force in kilograms.

## Use

Open the published GitHub Pages site in a browser that supports Web Bluetooth, such as Chrome or Edge on a supported desktop or Android device. Web Bluetooth requires HTTPS (or localhost); it is not supported in every browser or on iOS. Turn on the sensor, select **Connect device**, and choose it in the browser's Bluetooth picker. Unload the sensor and select **Tare & start**. Selecting it again tares and starts a fresh session. Disconnect when finished.

The current and maximum five-second means are time-weighted rolling averages using the device's sample timestamps. They appear after five seconds of readings. The chart and peak values cover the current session and remain visible after disconnection until a new session starts. Data stays in the browser and is not uploaded.

## Development and deployment

The site has no runtime dependencies or build step. Serve the repository root locally, for example with `python3 -m http.server`, and open `http://localhost:8000`. To publish, configure GitHub Pages to serve the repository root from the desired branch.

Run the session calculations and packet parsing tests with `npm test` (Node.js required). The Bluetooth protocol follows the [Tindeq Progressor API](https://tindeq.com/progressor_api/), which is also implemented by [Crimpdeq](https://github.com/crimpdeq/crimpdeq-firmware).
