export function formatBytes(value: number | null | undefined, unavailable = "unknown"): string {
  if (value == null || !Number.isFinite(value) || value < 0) return unavailable;
  if (value < 1024) return `${Math.round(value)} B`;

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let scaled = value / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && scaled >= 1024; index += 1) {
    scaled /= 1024;
    unit = units[index];
  }
  return `${scaled.toFixed(1)} ${unit}`;
}
