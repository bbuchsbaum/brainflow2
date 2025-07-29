import React from 'react';

interface LightboxViewProps {
  workspaceId: string;
}

export function LightboxView({ workspaceId }: LightboxViewProps) {
  return (
    <div className="h-full flex items-center justify-center text-gray-500">
      Lightbox View - Coming Soon
    </div>
  );
}