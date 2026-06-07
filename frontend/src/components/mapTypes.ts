export type MapLayerSettings = {
  storedOverview: boolean;
  livePerception: boolean;
  droneTrail: boolean;
  targetHistory: boolean;
  trajectory: boolean;
  labels: boolean;
};

export const DEFAULT_MAP_LAYERS: MapLayerSettings = {
  storedOverview: true,
  livePerception: true,
  droneTrail: true,
  targetHistory: true,
  trajectory: true,
  labels: true,
};
