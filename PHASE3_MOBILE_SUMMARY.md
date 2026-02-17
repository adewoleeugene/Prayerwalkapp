# Phase 3: Mobile Application - Complete

The mobile application for Charis Prayer Walk has been built using **Expo (React Native)**. It fully integrates with the Phase 2 backend.

## 📱 Features Implemented

### 1. Authentication
- **Screens**: `LoginScreen`, `SignupScreen`
- **Logic**: `AuthContext` manages user session using `expo-secure-store`.
- **API**: Connects to `/auth/login` and `/auth/signup`.

### 2. Map & Discovery
- **Screen**: `MapScreen`
- **Tech**: `react-native-maps` (Google/Apple Maps).
- **Features**:
  - Shows User Location (Blue dot).
  - Shows Prayer Locations (Markers).
  - Tap marker to view details and "Start Walk".
  - **Offline support**: Caches locations using `AsyncStorage` for viewing without internet.

### 3. Prayer Walk (The "Pokémon Go" Mode)
- **Screen**: `WalkScreen`
- **Tech**: `expo-location` (High accuracy GPS) + `WebSocket`.
- **Logic**:
  - Starts a session via API.
  - Streams live GPS coordinates to Backend WebSocket (`LOCATION_UPDATE`).
  - Polls `/walks/arrive` to check proximity.
  - Unlocks Prayer Content when close (< 50m).
  - "Complete Prayer" button awards points and badges.

### 4. Profile
- **Screen**: `ProfileScreen`
- **Features**: Shows stats (Distance, Points, Badges) and Logout.

## 📂 Project Structure (`mobile/`)

```
mobile/src/
├── api/
│   └── client.ts         # Axios client + Token Interceptor
├── context/
│   └── AuthContext.tsx   # Global Auth State
├── navigation/
│   └── AppNavigator.tsx  # Stack Navigator (Auth vs App)
├── screens/
│   ├── auth/             # Login, Signup
│   └── app/              # Map, Walk, Profile
├── types/
│   └── index.ts          # Shared Interfaces
└── App.tsx               # Entry Point
```

## 🚀 How to Run

1. **Start Backend** (if not running):
   ```bash
   cd ..
   npm run dev
   ```

2. **Start Mobile App**:
   ```bash
   cd mobile
   npm start
   ```

3. **Open on Device/Simulator**:
   - **iOS Simulator**: Press `i` in terminal.
   - **Android Emulator**: Press `a` in terminal.
   - **Physical Device**: Install "Expo Go" app and scan the QR code.

   *Note: Ensure your phone is on the same Wi-Fi as your computer if using physical device. You may need to update `BASE_URL` in `src/api/client.ts` to your computer's local IP (e.g., `http://192.168.1.X:3001`) instead of `localhost`.*

## ⚠️ Configuration Notes

- **Maps**: `react-native-maps` works out-of-the-box on Expo Go/Simulators (using Apple Maps on iOS, Google Maps on Android). usage.
- **Location Permissions**: The app will request "Foreground Location" permission on first launch.
- **Offline Mode**: Locations are cached automatically. If you restart the app without internet, it will load markers from the last successful fetch.
