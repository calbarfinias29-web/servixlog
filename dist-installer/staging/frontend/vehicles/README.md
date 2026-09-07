# Catalog imagini vehicule — ServiceX

Sistem: **Marcă + Model → imagine** (fără VIN, fără upload obligatoriu, fără servicii externe).

Logica de rezoluție este în `src/lib/vehicleCatalog.ts` (`vehicleImageSources`).
Prioritatea lanțului de fallback:

1. `photo_url` (dacă mașina are deja o fotografie încărcată în aplicație)
2. `public/vehicles/<marca>/<model>/<decada-an>.png` — generație, opțional (ex: `mercedes/clasa-c/2010.png`)
3. `public/vehicles/<marca>/<model>.png` — fotografie reală a modelului (dacă adminul a adăugat-o)
4. `public/vehicles/<marca>/<model>.svg` — **ilustrația vectorială a modelului, inclusă în proiect** (generată cu `node tools/gen-vehicle-art.cjs`; 22 modele, fiecare cu silueta proprie — sedan/hatch/SUV — și culoarea tipică a modelului)
5. `public/vehicles/<marca>.svg` — imaginea mărcii (fallback, există pentru Mercedes/BMW/Audi)
6. `public/vehicles/placeholder.svg` — placeholder ServiceX (respectă Light/Dark)

Ilustrațiile SVG sunt asset-uri **create pentru proiect** (fără drepturi terți,
utilizare comercială liberă). Nu există niciodată imagine spartă: `VehicleImage`
trece automat la următorul src din lanț la `onError`.

## Cum adaugi o fotografie reală a modelului

1. Pregătește o imagine PNG: mașina completă, vedere ~3/4, fundal simplu, fără text/watermark, aceeași proporție pentru toate (recomandat 800×600, 4:3).
2. Salveaz-o cu slug-ul din catalog:
   - `Mercedes Clasa C` → `public/vehicles/mercedes/clasa-c.png`
   - `BMW Seria 3` → `public/vehicles/bmw/seria-3.png`
   - `Audi Q5` → `public/vehicles/audi/q5.png`
3. Opțional, pentru generații pe an: `public/vehicles/mercedes/clasa-c/2010.png` (decada anului).
4. Gata — dashboard-ul (`MAȘINĂ CURENTĂ`) o afișează automat la următoarea încărcare.

Căile sunt slug-uite: litere mici, diacritice eliminate, spații → `-`.

## Marcă + Model la adăugarea mașinii

Formularul „Adaugă mașină" are sugestii (datalist) pentru Marcă și Model din
`VEHICLE_CATALOG`. Se acceptă și mărci/modele din afara catalogului — pentru
acestea se folosește lanțul de fallback (marcă → placeholder).
