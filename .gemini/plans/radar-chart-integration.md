# Plan: Radar Chart Integration for Weekly Performance

Add a high-fidelity Radar Chart to the "Day of Week" performance widget to fill visual gaps and provide multi-dimensional insights.

## Steps

1. **Refactor Imports**: Add `Radar`, `RadarChart`, `PolarGrid`, `PolarAngleAxis`, and `PolarRadiusAxis` to the `recharts` imports in `components/analytics/SessionWidgets.tsx`.
2. **Update Data Logic**: In `DailyActivityHeatmap`, calculate `absPnl` for each day to map it to the radar axes.
3. **Implement Radar View**: 
    - Insert the `RadarChart` component between the header and the progress bars.
    - Set a fixed height of `240px`.
    - Apply `brand-purple` styling (`#8251EE`) with high-contrast tooltips.
4. **Layout Adjustment**: Move the existing progress bars to the bottom of the widget and adjust spacing (`mt-auto`) to ensure a compact, high-density layout.

## Verification
- Verify that the Radar points correctly represent the P&L of each day (Mon-Fri).
- Confirm that the tooltip displays the correct currency-formatted P&L.
- Check both Dark and Light modes for visual clarity.
