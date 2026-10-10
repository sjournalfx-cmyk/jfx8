import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T | ((val: T) => T)) => void] {
  // Get from local storage then use useState
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      if (typeof window === 'undefined') {
        return initialValue;
      }
      const item = window.localStorage.getItem(key);
      if (item === null) return initialValue;
      
      const parsed = JSON.parse(item);
      return parsed !== null ? parsed : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  });

  // Wrapped version of useState's setter function that persists to localStorage.
  // Using useCallback and functional updates to ensure stability and correctness.
  const setValue = useCallback((value: T | ((val: T) => T)) => {
    try {
      setStoredValue((prevStoredValue) => {
        const valueToStore = value instanceof Function ? value(prevStoredValue) : value;

        // NOTE: this runs inside the state updater (React may invoke it during
        // dispatch, outside the outer try/catch), so storage failures must be
        // guarded here — otherwise blocked storage (private mode, quota,
        // missing localStorage) crashes the render instead of degrading to
        // in-memory state.
        try {
          if (typeof window !== 'undefined' && window.localStorage) {
            window.localStorage.setItem(key, JSON.stringify(valueToStore));
          }
        } catch (storageError) {
          console.warn(`Error persisting localStorage key "${key}":`, storageError);
        }

        return valueToStore;
      });
    } catch (error) {
      console.warn(`Error setting localStorage key "${key}":`, error);
    }
  }, [key]);

  // Subscribe to storage events to sync across tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === key && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed !== null) {
            setStoredValue(parsed);
          }
        } catch (err) {
          console.error("Storage sync parse error", err);
        }
      }
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      return () => window.removeEventListener('storage', handleStorageChange);
    }
  }, [key]);

  return [storedValue, setValue];
}
