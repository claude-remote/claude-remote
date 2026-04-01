import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionMeta } from '@/shared/types';

interface Favorite {
  id: string;
  label: string;
  path: string;
}

interface CwdPickerProps {
  cwd: string;
  favorites: Favorite[];
  session?: Pick<SessionMeta, 'id'>;
  onChangeCwd?: (path: string) => void;
  onAddFavorite?: (path: string, label?: string) => void;
  onBrowse?: (path: string) => Promise<string[]>;
}

export function CwdPicker({
  cwd,
  favorites,
  onChangeCwd,
  onAddFavorite,
  onBrowse,
}: CwdPickerProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClick);
      return () => document.removeEventListener('mousedown', handleClick);
    }
  }, [open]);

  // Autocomplete: fetch directory suggestions as user types
  useEffect(() => {
    if (!inputValue || !onBrowse) {
      setSuggestions([]);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingSuggestions(true);
      try {
        const dirs = await onBrowse(inputValue);
        setSuggestions(dirs);
      } catch {
        setSuggestions([]);
      } finally {
        setLoadingSuggestions(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, onBrowse]);

  const handleToggle = useCallback(() => {
    setOpen((prev) => {
      if (!prev) {
        setInputValue('');
        setSuggestions([]);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      return !prev;
    });
  }, []);

  const handleSelect = useCallback(
    (path: string) => {
      onChangeCwd?.(path);
      setOpen(false);
      setInputValue('');
      setSuggestions([]);
    },
    [onChangeCwd],
  );

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && inputValue.trim()) {
        handleSelect(inputValue.trim());
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [inputValue, handleSelect],
  );

  const handleAddFavorite = useCallback(() => {
    onAddFavorite?.(cwd);
  }, [cwd, onAddFavorite]);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Current CWD display / toggle */}
      <button
        onClick={handleToggle}
        className="flex w-full items-center gap-2 rounded border border-gray-800 bg-gray-900 px-3 py-2 text-left hover:border-gray-700 transition-colors"
      >
        <span className="text-xs text-gray-500">CWD</span>
        <span className="flex-1 truncate text-sm font-medium text-gray-200">
          {cwd}
        </span>
        <span className="text-xs text-gray-600">{open ? '\u25B2' : '\u25BC'}</span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded border border-gray-800 bg-gray-900 shadow-xl">
          {/* Path input with autocomplete */}
          <div className="border-b border-gray-800 p-2">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder="Type path to navigate..."
              className="w-full rounded border border-gray-700 bg-gray-800 px-2 py-1.5 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-gray-600"
            />
            {loadingSuggestions && (
              <p className="mt-1 text-xs text-gray-600">Loading...</p>
            )}
            {suggestions.length > 0 && (
              <ul className="mt-1 max-h-32 overflow-auto">
                {suggestions.map((dir) => (
                  <li key={dir}>
                    <button
                      onClick={() => handleSelect(dir)}
                      className="block w-full truncate px-2 py-1 text-left text-xs text-gray-400 hover:bg-gray-800 hover:text-gray-200"
                    >
                      {dir}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Favorites section */}
          {favorites.length > 0 && (
            <div className="border-b border-gray-800 p-2">
              <p className="mb-1 text-xs font-medium text-gray-500">Favorites</p>
              <ul className="space-y-0.5">
                {favorites.map((fav) => (
                  <li key={fav.id}>
                    <button
                      onClick={() => handleSelect(fav.path)}
                      className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-gray-800 transition-colors"
                    >
                      <span className="text-yellow-500">{'\u2605'}</span>
                      <span className="flex-1 truncate text-gray-300">{fav.label}</span>
                      <span className="truncate text-xs text-gray-600">{fav.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 p-2">
            <button
              onClick={handleAddFavorite}
              className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-gray-200 transition-colors"
            >
              {'\u2605'} Add current to favorites
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
