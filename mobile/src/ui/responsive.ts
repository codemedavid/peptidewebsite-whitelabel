// Responsive layout: the app is phone-first. On a tablet or a desktop browser
// (the web build) it becomes a centred frame — the header, tab bar and screens
// stop at APP_MAX_WIDTH instead of stretching edge to edge — and product grids
// gain columns. Single-column screens (forms, lists, the tracker) keep to
// READING_MAX_WIDTH so lines stay readable.
import { useWindowDimensions } from "react-native";
import { appWidth, gridColumns, tileWidth } from "./responsive-rules";

export { APP_MAX_WIDTH, READING_MAX_WIDTH, appWidth, gridColumns, isReadingRoute, tileWidth } from "./responsive-rules";

/** The app's width right now (the window, capped at APP_MAX_WIDTH). Use instead of the raw window width for layout. */
export function useAppWidth(): number {
  return appWidth(useWindowDimensions().width);
}

/** Columns and tile width for a product grid, from the app's current width. */
export function useGrid(gutter: number, gap: number): { columns: number; tile: number } {
  const width = useAppWidth();
  const columns = gridColumns(width);
  return { columns, tile: tileWidth(width, columns, gutter, gap) };
}
