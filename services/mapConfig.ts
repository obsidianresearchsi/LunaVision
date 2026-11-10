/// <reference types="vite/client" />

// Basemap presentation only; marker, filter, and camera logic stays in GlobalMap.
export function getBasemap(token?: string, style: 'satellite-streets-v12' | 'dark-v11' = 'satellite-streets-v12') {
  const accessToken = token?.trim();
  return accessToken ? {
    url: `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/{z}/{x}/{y}?access_token=${encodeURIComponent(accessToken)}`,
    options: {
      tileSize: 512,
      zoomOffset: -1,
      maxZoom: 19,
      attribution: '<a class="lunar-mapbox-logo" href="https://www.mapbox.com/" aria-label="Mapbox"><img src="/lunar/mapbox-logo.svg" alt="Mapbox"></a> &copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | <a href="https://apps.mapbox.com/feedback/" target="_blank" rel="noopener noreferrer">Improve this map</a>'
    }
  } : {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    options: {
      subdomains: 'abcd',
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    }
  };
}

const token = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN;
export const basemap = getBasemap(token);
export const commandBasemap = getBasemap(token, 'dark-v11');
