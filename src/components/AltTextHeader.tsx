import { Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AltTextHeaderProps {
  altText: string;
  onSpeak: () => void;
  isSpeaking: boolean;
  isSupported: boolean;
}

export function AltTextHeader({ altText, onSpeak, isSpeaking, isSupported }: AltTextHeaderProps) {
  return (
    <header className="border-b border-border bg-card">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-start gap-4">
          {/* ALT Badge */}
          <div className="flex-shrink-0">
            <span className="inline-flex items-center justify-center px-2.5 py-1 text-xs font-semibold tracking-wide bg-alt-badge text-alt-badge-fg rounded">
              ALT
            </span>
          </div>
          
          {/* Alt Text Content */}
          <div className="flex-1 min-w-0">
            <p className="text-foreground text-base leading-relaxed">
              {altText}
            </p>
          </div>
          
          {/* Speaker Button */}
          <div className="flex-shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={onSpeak}
              disabled={!isSupported}
              aria-label={isSpeaking ? "Stop speaking" : "Read alt text aloud"}
              className={`
                relative focus-ring
                ${isSpeaking ? 'text-speaking' : 'text-muted-foreground hover:text-foreground'}
              `}
            >
              {isSpeaking ? (
                <>
                  <Volume2 className="h-5 w-5 speaking-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-speaking opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-speaking"></span>
                  </span>
                </>
              ) : (
                <Volume2 className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
        
        {/* Keyboard hint */}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">R</kbd>
          <span>Open rotor</span>
          <span className="mx-2">·</span>
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">←</kbd>
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">→</kbd>
          <span>Switch lens</span>
          <span className="mx-2">·</span>
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">↑</kbd>
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">↓</kbd>
          <span>Navigate items</span>
          <span className="mx-2">·</span>
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">Enter</kbd>
          <span>Select</span>
          <span className="mx-2">·</span>
          <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-[10px]">Esc</kbd>
          <span>Return to image</span>
        </div>
      </div>
    </header>
  );
}
