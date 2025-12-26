import { useState, useCallback, useEffect } from 'react';
import { LensType, RotorItem } from '@/data/demoImage';

interface UseRotorNavigationProps {
  lenses: Record<LensType, RotorItem[]>;
  onItemSelect: (item: RotorItem | null) => void;
  onAnnounce: (message: string) => void;
  isRotorFocused: boolean;
  setIsRotorFocused: (focused: boolean) => void;
}

interface UseRotorNavigationReturn {
  currentLens: LensType;
  setCurrentLens: (lens: LensType) => void;
  focusedIndex: number;
  selectedItem: RotorItem | null;
  handleKeyDown: (e: KeyboardEvent) => void;
  selectItem: (item: RotorItem) => void;
  clearSelection: () => void;
  currentItems: RotorItem[];
  navigateToLens: (direction: 'left' | 'right') => void;
}

const lensOrder: LensType[] = ['objects', 'layout', 'style'];
const lensLabels: Record<LensType, string> = {
  objects: 'Objects',
  layout: 'Layout',
  style: 'Style'
};

export function useRotorNavigation({
  lenses,
  onItemSelect,
  onAnnounce,
  isRotorFocused,
  setIsRotorFocused
}: UseRotorNavigationProps): UseRotorNavigationReturn {
  const [currentLens, setCurrentLens] = useState<LensType>('objects');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedItem, setSelectedItem] = useState<RotorItem | null>(null);

  const currentItems = lenses[currentLens] || [];

  const navigateToLens = useCallback((direction: 'left' | 'right') => {
    const currentIndex = lensOrder.indexOf(currentLens);
    let newIndex: number;
    
    if (direction === 'left') {
      newIndex = currentIndex === 0 ? lensOrder.length - 1 : currentIndex - 1;
    } else {
      newIndex = currentIndex === lensOrder.length - 1 ? 0 : currentIndex + 1;
    }
    
    const newLens = lensOrder[newIndex];
    setCurrentLens(newLens);
    setFocusedIndex(0);
    onAnnounce(`${lensLabels[newLens]} lens, ${lenses[newLens].length} items`);
  }, [currentLens, lenses, onAnnounce]);

  const selectItem = useCallback((item: RotorItem) => {
    setSelectedItem(item);
    onItemSelect(item);
    onAnnounce(item.description);
  }, [onItemSelect, onAnnounce]);

  const clearSelection = useCallback(() => {
    setSelectedItem(null);
    onItemSelect(null);
  }, [onItemSelect]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // R key toggles rotor focus
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      setIsRotorFocused(!isRotorFocused);
      if (!isRotorFocused) {
        onAnnounce(`Rotor opened. ${lensLabels[currentLens]} lens, ${currentItems.length} items. Use arrow keys to navigate.`);
      } else {
        onAnnounce('Rotor closed');
      }
      return;
    }

    // Escape returns focus to image
    if (e.key === 'Escape') {
      e.preventDefault();
      setIsRotorFocused(false);
      clearSelection();
      onAnnounce('Returned to image');
      return;
    }

    if (!isRotorFocused) return;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (currentItems.length > 0) {
          const newIndex = focusedIndex === 0 ? currentItems.length - 1 : focusedIndex - 1;
          setFocusedIndex(newIndex);
          onAnnounce(currentItems[newIndex].label);
        }
        break;
        
      case 'ArrowDown':
        e.preventDefault();
        if (currentItems.length > 0) {
          const newIndex = focusedIndex === currentItems.length - 1 ? 0 : focusedIndex + 1;
          setFocusedIndex(newIndex);
          onAnnounce(currentItems[newIndex].label);
        }
        break;
        
      case 'ArrowLeft':
        e.preventDefault();
        navigateToLens('left');
        break;
        
      case 'ArrowRight':
        e.preventDefault();
        navigateToLens('right');
        break;
        
      case 'Enter':
        e.preventDefault();
        if (currentItems[focusedIndex]) {
          selectItem(currentItems[focusedIndex]);
        }
        break;
    }
  }, [
    isRotorFocused,
    setIsRotorFocused,
    currentLens,
    currentItems,
    focusedIndex,
    navigateToLens,
    selectItem,
    clearSelection,
    onAnnounce
  ]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return {
    currentLens,
    setCurrentLens,
    focusedIndex,
    selectedItem,
    handleKeyDown,
    selectItem,
    clearSelection,
    currentItems,
    navigateToLens
  };
}
