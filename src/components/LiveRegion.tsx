import { useEffect, useState } from 'react';

interface LiveRegionProps {
  message: string;
}

export function LiveRegion({ message }: LiveRegionProps) {
  const [currentMessage, setCurrentMessage] = useState('');

  useEffect(() => {
    if (message) {
      // Clear and reset to trigger screen reader announcement
      setCurrentMessage('');
      const timer = setTimeout(() => setCurrentMessage(message), 50);
      return () => clearTimeout(timer);
    }
  }, [message]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {currentMessage}
    </div>
  );
}
