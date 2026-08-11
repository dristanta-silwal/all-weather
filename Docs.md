# Project Goal: El Paso Historical Temperature Visualizer

Build a static web application hosted on GitHub Pages that tracks, updates, and visualizes 5 years of daily temperature data for El Paso, Texas.

## Core Requirements

1. Data Pipeline & Storage (GitHub Actions)
   - Maintain a single static JSON file containing 5 years of daily high and low temperatures for El Paso.
   - Set up an automated daily GitHub Action cron job to fetch yesterday's weather data from Open-Meteo and update the JSON file automatically.

2. Visual Chart & Display
   - Render a responsive time-series line chart displaying daily high and low temperatures across the 5-year period.
   - Include interactive brush controls or range sliders allowing users to zoom into specific months, seasons, or years.
   - Provide quick-filter preset buttons (e.g., "Last 30 Days", "This Year", "5-Year Overview").

3. Unit Toggle & State
   - Provide a persistent toggle button to switch instantly between Celsius and Fahrenheit across all chart axes, tooltips, and summary stats.
   - Save the user's unit preference in browser LocalStorage.

4. User Insights
   - Display a top summary row with key statistics calculated from the active dataset (e.g., Highest recorded temp, Lowest recorded temp, Total days over 100°F / 38°C).

5. Deployment
   - Configure the repository for automatic deployment to GitHub Pages upon every commit to the main branch.