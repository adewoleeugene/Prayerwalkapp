import AsyncStorage from '@react-native-async-storage/async-storage';

const ACTIVE_WALK_CACHE_KEY = 'active_walk_state_v1';

export async function saveActiveWalkState(value: unknown) {
  await AsyncStorage.setItem(ACTIVE_WALK_CACHE_KEY, JSON.stringify(value));
}

export async function loadActiveWalkState<T>() {
  const raw = await AsyncStorage.getItem(ACTIVE_WALK_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function clearActiveWalkState() {
  await AsyncStorage.removeItem(ACTIVE_WALK_CACHE_KEY);
}
