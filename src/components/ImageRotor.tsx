import { useState, useEffect, useCallback } from 'react';
import { AltTextHeader } from './AltTextHeader';
import { RotorPanel } from './RotorPanel';
import { ImageView } from './ImageView';
import { DetailPanel } from './DetailPanel';
import { LiveRegion } from './LiveRegion';
import { useSpeech } from '@/hooks/useSpeech';
import { useRotorNavigation } from '@/hooks/useRotorNavigation';
import { demoImage, RotorItem } from '@/data/demoImage';

export function ImageRotor() {
  const [isRotorFocused, setIsRotorFocused] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [selectedItem, setSelectedItem] = useState<RotorItem | null>(null);
  const [hasSpokenAltText, setHasSpokenAltText] = useState(false);
  
  const { speak, isSpeaking, isSupported, replayLast } = useSpeech();

  const handleAnnounce = useCallback((message: string) => {
    setAnnouncement(message);
  }, []);

  const handleItemSelect = useCallback((item: RotorItem | null) => {
    setSelectedItem(item);
    if (item) {
      speak(item.description);
    }
  }, [speak]);

  const {
    currentLens,
    focusedIndex,
    currentItems,
    navigateToLens,
    selectItem,
    clearSelection
  } = useRotorNavigation({
    lenses: demoImage.lenses,
    onItemSelect: handleItemSelect,
    onAnnounce: handleAnnounce,
    isRotorFocused,
    setIsRotorFocused
  });

  // Speak alt text on initial load
  useEffect(() => {
    if (!hasSpokenAltText && isSupported) {
      const timer = setTimeout(() => {
        speak(demoImage.altText);
        setHasSpokenAltText(true);
        handleAnnounce(demoImage.altText);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [hasSpokenAltText, isSupported, speak, handleAnnounce]);

  const handleSpeakAltText = useCallback(() => {
    speak(demoImage.altText);
  }, [speak]);

  const handleCloseDetail = useCallback(() => {
    clearSelection();
    setSelectedItem(null);
  }, [clearSelection]);

  const handleItemFocus = useCallback((index: number) => {
    // This is handled by the navigation hook
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Live Region for screen readers */}
      <LiveRegion message={announcement} />
      
      {/* Alt Text Header */}
      <AltTextHeader
        altText={demoImage.altText}
        onSpeak={handleSpeakAltText}
        isSpeaking={isSpeaking}
        isSupported={isSupported}
      />
      
      {/* Main Content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
          {/* Rotor Panel - Left */}
          <div className="lg:col-span-3 h-[400px] lg:h-[600px]">
            <RotorPanel
              currentLens={currentLens}
              items={currentItems}
              focusedIndex={focusedIndex}
              selectedItem={selectedItem}
              isRotorFocused={isRotorFocused}
              onLensChange={navigateToLens}
              onItemSelect={selectItem}
              onItemFocus={handleItemFocus}
            />
          </div>
          
          {/* Image View - Center */}
          <div className="lg:col-span-6">
            <ImageView
              src={demoImage.src}
              altText={demoImage.altText}
              selectedItem={selectedItem}
              isFocused={!isRotorFocused && !selectedItem}
            />
          </div>
          
          {/* Detail Panel - Right */}
          <div className="lg:col-span-3 h-[300px] lg:h-[600px] bg-card rounded-lg border border-border overflow-hidden">
            <DetailPanel
              item={selectedItem}
              onSpeak={speak}
              onClose={handleCloseDetail}
              isSpeaking={isSpeaking}
            />
          </div>
        </div>
      </main>
      
      {/* Footer with status */}
      <footer className="border-t border-border py-3 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>Image Rotor Prototype</span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">Accessibility Research Tool</span>
          </div>
          
          <div className="flex items-center gap-3">
            {/* Speech status */}
            {isSupported ? (
              <span className={`flex items-center gap-1.5 ${isSpeaking ? 'text-speaking' : ''}`}>
                <span className={`h-2 w-2 rounded-full ${isSpeaking ? 'bg-speaking speaking-pulse' : 'bg-muted-foreground/30'}`} />
                {isSpeaking ? 'Speaking...' : 'TTS Ready'}
              </span>
            ) : (
              <span className="text-destructive">TTS Unavailable</span>
            )}
            
            {/* Rotor status */}
            <span className="hidden sm:flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${isRotorFocused ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
              Rotor {isRotorFocused ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
